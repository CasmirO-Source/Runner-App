import { z } from 'zod';

import { refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';

// Creates or edits the caller's own profile. The only way a profile can be
// written (the database gives the app no write access to profiles).
//
// The row written is always the caller's: the ID comes from their verified
// login token. Sending an "id" (or any other unexpected field) is refused by
// the strict schema before this code runs.
//
// The database repeats every rule below as a constraint (length, characters,
// avatar range, over 18, name screening, unique names), so the two layers
// back each other up (Appendix A #16).

const NAME_PATTERN = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/;
const CITY_PATTERN = /^[A-Za-z][A-Za-z .'-]*[A-Za-z]$/;
const collapseSpaces = (s: string) => s.trim().replace(/ +/g, ' ');

const displayName = z
  .string({ error: 'Pick a name.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(3, { error: 'Names need at least 3 characters.' })
      .max(20, { error: 'Names can be up to 20 characters.' })
      .regex(NAME_PATTERN, { error: 'Use letters, numbers, spaces and underscores only.' }),
  );

const avatarId = z
  .number({ error: 'Pick an avatar.' })
  .int({ error: 'Pick an avatar.' })
  .min(1, { error: 'Pick an avatar.' })
  .max(12, { error: 'Pick an avatar.' });

// Optional. An empty box means "no city".
const homeCity = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string({ error: 'Check your city.' })
    .transform(collapseSpaces)
    .pipe(
      z
        .string()
        .min(2, { error: 'Check your city.' })
        .max(40, { error: 'City names can be up to 40 characters.' })
        .regex(CITY_PATTERN, { error: 'Use letters, spaces, full stops, apostrophes and hyphens only.' }),
    )
    .nullable(),
);

// Estimated Stride (PRD 4.5): a recent 5 km time in seconds (13 to 90
// minutes) or null for "not sure", and typical weekly km (0 to 150). The
// database checks the same ranges and refuses once the runner is placed.
const fiveKSeconds = z
  .number({ error: 'Enter a 5 km time between 13 and 90 minutes.' })
  .int({ error: 'Enter a 5 km time between 13 and 90 minutes.' })
  .min(780, { error: 'Enter a 5 km time between 13 and 90 minutes.' })
  .max(5400, { error: 'Enter a 5 km time between 13 and 90 minutes.' })
  .nullable();
const weeklyKm = z
  .number({ error: 'Enter a weekly distance from 0 to 150 km.' })
  .int({ error: 'Enter a weekly distance from 0 to 150 km.' })
  .min(0, { error: 'Enter a weekly distance from 0 to 150 km.' })
  .max(150, { error: 'Enter a weekly distance from 0 to 150 km.' });
const estimate = z.strictObject({ five_k_s: fiveKSeconds, weekly_km: weeklyKm });

const createInput = z.strictObject({
  action: z.literal('create'),
  display_name: displayName,
  avatar_id: avatarId,
  home_city: homeCity.optional(),
  over_18: z.literal(true, { error: 'You need to be 18 or over to use the app.' }),
  estimate: estimate.optional(),
});

const updateInput = z.strictObject({
  action: z.literal('update'),
  display_name: displayName.optional(),
  avatar_id: avatarId.optional(),
  home_city: homeCity.optional(),
});

// Set, change or clear (null) the estimate. Only until the runner is placed.
const estimateInput = z.strictObject({
  action: z.literal('estimate'),
  estimate: estimate.nullable(),
});

const schema = z.discriminatedUnion('action', [createInput, updateInput, estimateInput]);
type Input = z.output<typeof schema>;

const PROFILE_COLUMNS =
  'id, display_name, avatar_id, home_city, over_18, created_at, updated_at, stride, placement_runs, estimate_5k_s, estimate_weekly_km, estimated_stride';

const ESTIMATE_REFUSALS = {
  already_placed: new HttpError(409, 'already_placed', 'Your Stride comes from your runs now, so the estimate is closed.'),
  invalid_estimate: new HttpError(400, 'invalid_input', 'Some details need fixing.'),
  profile_missing: new HttpError(404, 'profile_missing', 'Set up your profile first.'),
};

function setEstimate(admin: HandlerContext<Input>['admin'], userId: string, value: z.output<typeof estimate> | null) {
  return admin.rpc('set_stride_estimate', {
    p_user_id: userId,
    p_5k_s: value?.five_k_s ?? null,
    p_weekly_km: value?.weekly_km ?? null,
  });
}

// Turns database refusals into messages the user can act on. Matched by
// constraint name only; the database's own message (which can contain what the
// user typed) is never passed on or logged.
function fromDatabaseError(error: { code?: string; message?: string }): HttpError | null {
  const constraint = /constraint "([a-z0-9_]+)"/.exec(error.message ?? '')?.[1];
  if (error.code === '23505' && constraint === 'profiles_display_name_unique') {
    return new HttpError(409, 'name_taken', 'Some details need fixing.', {}, {
      display_name: "That name's taken. Try another.",
    });
  }
  if (error.code === '23505' && constraint === 'profiles_pkey') {
    return new HttpError(409, 'profile_exists', "You've already set up your profile.");
  }
  if (error.code === '23514' && constraint === 'display_name_clean') {
    return new HttpError(422, 'name_not_allowed', 'Some details need fixing.', {}, {
      display_name: "That name isn't allowed. Pick another.",
    });
  }
  return null;
}

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  if (input.action === 'create') {
    const { data, error } = await admin
      .from('profiles')
      .insert({
        id: userId,
        display_name: input.display_name,
        avatar_id: input.avatar_id,
        home_city: input.home_city ?? null,
        over_18: true,
      })
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw fromDatabaseError(error) ?? error;
    if (!input.estimate) return { status: 201, body: { profile: data } };

    // The profile exists now, so a failed estimate must not fail sign-up: the
    // runner can add it later from the You tab.
    const { error: estimateError } = await setEstimate(admin, userId, input.estimate);
    if (estimateError) {
      log('warn', { fn: 'profile', event: 'estimate_not_saved', dbCode: (estimateError as DbError).code });
      return { status: 201, body: { profile: data } };
    }
    const { data: withEstimate, error: readError } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
    if (readError) throw readError;
    return { status: 201, body: { profile: withEstimate } };
  }

  if (input.action === 'estimate') {
    const { error } = await setEstimate(admin, userId, input.estimate);
    if (error) throw refusal(error as DbError, ESTIMATE_REFUSALS) ?? error;
    const { data, error: readError } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
    if (readError) throw readError;
    return { status: 200, body: { profile: data } };
  }

  const patch: Record<string, unknown> = {};
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.avatar_id !== undefined) patch.avatar_id = input.avatar_id;
  if (input.home_city !== undefined) patch.home_city = input.home_city;
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, 'nothing_to_change', 'Nothing to change.');
  }

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw fromDatabaseError(error) ?? error;
  if (!data) {
    throw new HttpError(404, 'profile_missing', 'Set up your profile first.');
  }
  return { status: 200, body: { profile: data } };
}

Deno.serve(
  createHandler({
    name: 'profile',
    schema,
    // Not set by the PRD: a modest cap on profile edits, so names cannot be
    // cycled rapidly to probe the screen or which names are taken.
    limits: [{ scope: 'profile_write', limit: 20, windowSeconds: 3600 }],
    handle,
  }),
);
