import { z } from 'zod';

import { refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';

// Logs a run typed in by the runner (PRD 5.4, 6.1: manual entry, unverified).
//
// The app sends only when the run started, how far and how long. The source
// ('manual'), the owner (from the verified token) and the status are decided
// here and in the database. Every check (PRD 6.4) runs in public.record_run:
// a run that fails one is saved as flagged with the reasons, so the runner
// sees why it does not count, and it goes to the review queue.

const schema = z.strictObject({
  started_at: z.iso.datetime({ offset: true, error: 'Check the date and time.' }),
  // Wide bounds only stop nonsense. The real limits (0.5 to 100 km, pace)
  // are checks that flag the run with a reason, rather than refusing it.
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

const KNOWN = { invalid_run: new HttpError(400, 'invalid_input', 'Some details need fixing.') };

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  const { data, error } = await admin
    .rpc('record_run', {
      p_user_id: userId,
      p_source: 'manual',
      p_started_at: input.started_at,
      p_distance_m: input.distance_m,
      p_duration_s: input.duration_s,
      p_external_id: null,
      p_source_app: null,
      p_user_entered: null,
    })
    .single<{ status: string; run_id: string | null; reasons: string[] }>();
  if (error) throw refusal(error as DbError, KNOWN) ?? error;

  if (data.status === 'duplicate') {
    throw new HttpError(409, 'duplicate', "That overlaps a run you've already logged.");
  }
  if (data.status !== 'accepted' && data.status !== 'flagged') {
    throw new Error('Unexpected result from the database');
  }
  return { status: 201, body: { status: data.status, run_id: data.run_id, reasons: data.reasons } };
}

Deno.serve(
  createHandler({
    name: 'run-manual',
    schema,
    // PRD 9.3: manual run entry, 10 per day per user. Counted on every attempt.
    limits: [{ scope: 'run_manual', limit: 10, windowSeconds: 86400 }],
    handle,
  }),
);
