import { z } from 'zod';

import { constraintName, LEAGUE_NOT_FOUND, refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';

// Creates a league, or lets its owner rename it or change its settings
// (PRD 5.2, 8.2). The owner is always the caller from the verified token. The
// one-open-league rule, the member limit and ownership are all checked in the
// database (public.create_league and public.update_league).

const NAME_PATTERN = /^[A-Za-z0-9]+([ '-][A-Za-z0-9]+)*$/;
const collapseSpaces = (s: string) => s.trim().replace(/ +/g, ' ');

const leagueName = z
  .string({ error: 'Pick a league name.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(3, { error: 'League names need at least 3 characters.' })
      .max(30, { error: 'League names can be up to 30 characters.' })
      .regex(NAME_PATTERN, { error: 'Use letters, numbers, spaces, apostrophes and hyphens only.' }),
  );

const schema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    name: leagueName,
    verified_only: z.boolean({ error: 'Choose on or off.' }).optional(),
  }),
  z.strictObject({
    action: z.literal('update'),
    league_id: z.uuid({ error: "We couldn't find that league." }),
    name: leagueName.optional(),
    verified_only: z.boolean({ error: 'Choose on or off.' }).optional(),
  }),
]);
type Input = z.output<typeof schema>;

// PRD 9.3: 5 league creations per day per user. Counted on every attempt.
const CREATE_LIMIT = { scope: 'league_create', limit: 5, windowSeconds: 86400 };

const KNOWN = {
  league_limit_reached: new HttpError(409, 'league_limit_reached', 'You can run one league at a time.'),
  not_found: LEAGUE_NOT_FOUND(),
  nothing_to_change: new HttpError(400, 'nothing_to_change', 'Nothing to change.'),
};

function fromDatabase(error: DbError): HttpError | null {
  const known = refusal(error, KNOWN);
  if (known) return known;
  const constraint = constraintName(error);
  if (error.code === '23505' && constraint === 'leagues_one_open_per_owner') return KNOWN.league_limit_reached;
  if (error.code === '23514' && constraint === 'league_name_clean') {
    return new HttpError(422, 'name_not_allowed', 'Some details need fixing.', {}, { name: "That name isn't allowed. Pick another." });
  }
  return null;
}

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  if (input.action === 'create') {
    await enforceRateLimit(admin, CREATE_LIMIT, userId);
    const { data, error } = await admin
      .rpc('create_league', { p_owner_id: userId, p_name: input.name, p_verified_only: input.verified_only ?? false })
      .single();
    if (error) throw fromDatabase(error) ?? error;
    return { status: 201, body: { league: data } };
  }

  if (input.name === undefined && input.verified_only === undefined) {
    throw KNOWN.nothing_to_change;
  }
  const { data, error } = await admin
    .rpc('update_league', {
      p_actor_id: userId,
      p_league_id: input.league_id,
      p_name: input.name ?? null,
      p_verified_only: input.verified_only ?? null,
    })
    .single();
  if (error) throw fromDatabase(error) ?? error;
  return { status: 200, body: { league: data } };
}

Deno.serve(createHandler({ name: 'league', schema, handle }));
