import { z } from 'zod';

import { refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';

// Saves a run from a screenshot reading the runner has checked (PRD 6.3).
//
// The app sends the reading's ID and the values the runner confirmed. The
// database (confirm_screenshot_reading) compares them with what was read and
// decides the source: unchanged values make a screenshot run, any change makes
// a typed-in run (which counts towards the typed-in limit of 10 a day). The app
// cannot choose the source. The owner comes from the verified token, and a
// reading belonging to anyone else is refused.

const schema = z.strictObject({
  reading_id: z.uuid({ error: 'That reading was not found.' }),
  started_at: z.iso.datetime({ offset: true, error: 'Check the date and time.' }),
  distance_m: z
    .number({ error: 'Check the distance.' })
    .int({ error: 'Check the distance.' })
    .min(1, { error: 'Check the distance.' })
    .max(1_000_000, { error: 'Check the distance.' }),
  duration_s: z
    .number({ error: 'Check the time.' })
    .int({ error: 'Check the time.' })
    .min(1, { error: 'Check the time.' })
    .max(604_800, { error: 'Check the time.' }),
});
type Input = z.output<typeof schema>;

const KNOWN = {
  invalid_run: new HttpError(400, 'invalid_input', 'Some details need fixing.'),
  // Someone else's, expired or already used: one answer for all three.
  reading_unavailable: new HttpError(
    404,
    'reading_unavailable',
    'That reading has expired or was already used. Read the screenshot again, or type the run in.',
  ),
};

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  const { data, error } = await admin
    .rpc('confirm_screenshot_reading', {
      p_user_id: userId,
      p_reading_id: input.reading_id,
      p_started_at: input.started_at,
      p_distance_m: input.distance_m,
      p_duration_s: input.duration_s,
    })
    .single<{ status: string; run_id: string | null; reasons: string[]; saved_as: string; retry_after_seconds: number }>();
  if (error) throw refusal(error as DbError, KNOWN) ?? error;

  if (data.status === 'rate_limited') {
    const seconds = Math.max(1, data.retry_after_seconds);
    throw new HttpError(429, 'rate_limited', `You've typed in the most runs allowed today. Try again in ${seconds} seconds.`, {
      'Retry-After': String(seconds),
    });
  }
  if (data.status === 'duplicate') {
    throw new HttpError(409, 'duplicate', "That overlaps a run you've already logged.");
  }
  if (data.status !== 'accepted' && data.status !== 'flagged') {
    throw new Error('Unexpected result from the database');
  }
  return {
    status: 201,
    body: { status: data.status, run_id: data.run_id, reasons: data.reasons, saved_as: data.saved_as },
  };
}

Deno.serve(
  createHandler({
    name: 'screenshot-confirm',
    schema,
    // Each reading can be confirmed once, and readings are limited to 10 a
    // day, so the global limits (60 a minute per user and per IP) are enough.
    // Changed readings also count towards the typed-in limit, in the database.
    handle,
  }),
);
