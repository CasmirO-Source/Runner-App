import { z } from 'zod';

import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';

// A member leaves a league, or the owner removes a member (PRD 5.2). Removals
// and league closures are written to the audit log by the database. The owner
// can leave only as the last member, which closes the league.

const id = (message: string) => z.uuid({ error: message });

const schema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('leave'), league_id: id("We couldn't find that league.") }),
  z.strictObject({
    action: z.literal('remove'),
    league_id: id("We couldn't find that league."),
    user_id: id("We couldn't find that runner."),
  }),
]);
type Input = z.output<typeof schema>;

const RESULTS: Record<string, HttpError | { status: number }> = {
  left: { status: 200 },
  closed: { status: 200 },
  removed: { status: 200 },
  not_found: new HttpError(404, 'not_found', "We couldn't find that league or runner."),
  owner_must_be_last: new HttpError(409, 'owner_must_be_last', 'You run this league. Remove the other members before you leave.'),
  cannot_remove_owner: new HttpError(400, 'cannot_remove_owner', "You can't remove yourself. Leave the league instead."),
};

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  const { data, error } =
    input.action === 'leave'
      ? await admin.rpc('leave_league', { p_user_id: userId, p_league_id: input.league_id })
      : await admin.rpc('remove_league_member', { p_actor_id: userId, p_league_id: input.league_id, p_user_id: input.user_id });
  if (error) throw error;
  const result = typeof data === 'string' ? RESULTS[data] : undefined;
  if (!result) throw new Error('Unexpected result from the database');
  if (result instanceof HttpError) throw result;
  return { status: result.status, body: { status: data } };
}

Deno.serve(createHandler({ name: 'league-member', schema, handle }));
