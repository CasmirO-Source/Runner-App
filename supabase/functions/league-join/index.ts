import { z } from 'zod';

import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';

// Joins the caller to a league with an invite code (PRD 5.2). Limited to 10
// attempts per hour per user, so codes cannot be guessed (PRD 9.3).
//
// Every unusable code gets the same reply (unknown, expired, revoked, a
// closed league, or a full one), so attempts reveal nothing about which codes
// exist. The member limit is checked in the database with the league locked,
// so two people joining at once cannot take a league past its limit.

const schema = z.strictObject({
  // Codes are shown in capitals, but people type them any way: ignore case,
  // spaces and hyphens. The database checks the exact format.
  code: z
    .string({ error: 'Enter the code.' })
    .max(40, { error: "That code doesn't work. Ask for a new one." })
    .transform((s) => s.toUpperCase().replace(/[\s-]/g, '')),
});
type Input = z.output<typeof schema>;

const BAD_CODE = () => new HttpError(404, 'invalid_code', "That code doesn't work. Ask for a new one.");

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  const { data, error } = await admin
    .rpc('join_league', { p_user_id: userId, p_code: input.code })
    .single<{ status: string; league_id: string | null }>();
  if (error) throw error;
  if (data.status === 'joined' || data.status === 'already_member') {
    return { status: 200, body: { status: data.status, league_id: data.league_id } };
  }
  throw BAD_CODE();
}

Deno.serve(
  createHandler({
    name: 'league-join',
    schema,
    limits: [{ scope: 'league_join', limit: 10, windowSeconds: 3600 }],
    handle,
  }),
);
