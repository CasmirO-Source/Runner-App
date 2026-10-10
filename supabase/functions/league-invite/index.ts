import { z } from 'zod';

import { LEAGUE_NOT_FOUND, refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';

// The league owner makes a new invite code (which replaces the old one) or
// revokes the current one (PRD 5.2). Ownership is checked in the database;
// anyone else gets the same "not found" as for a league that does not exist.

const leagueId = z.uuid({ error: "We couldn't find that league." });

const schema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), league_id: leagueId }),
  z.strictObject({ action: z.literal('revoke'), league_id: leagueId }),
]);
type Input = z.output<typeof schema>;

const KNOWN = { not_found: LEAGUE_NOT_FOUND() };
const fromDatabase = (error: DbError): HttpError | null => refusal(error, KNOWN);

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  if (input.action === 'create') {
    const { data, error } = await admin
      .rpc('create_invite_code', { p_actor_id: userId, p_league_id: input.league_id })
      .single();
    if (error) throw fromDatabase(error) ?? error;
    return { status: 201, body: { invite: data } };
  }
  const { data, error } = await admin.rpc('revoke_invite_code', { p_actor_id: userId, p_league_id: input.league_id });
  if (error) throw fromDatabase(error) ?? error;
  return { status: 200, body: { revoked: data === true } };
}

Deno.serve(
  createHandler({
    name: 'league-invite',
    schema,
    // Not set by the PRD: a cap on making and revoking codes.
    limits: [{ scope: 'league_invite', limit: 20, windowSeconds: 86400 }],
    handle,
  }),
);
