import { HttpError } from './http.ts';

export type DbError = { code?: string; message?: string };

// The league functions in the database refuse with SQLSTATE P0001 and a short
// fixed code as the message (for example "not_found"). This turns those codes
// into messages for the user. Only our own fixed codes are ever matched, so no
// database text a user typed can reach the reply. Anything not listed is
// thrown on as an unexpected error (generic 500 with a reference).
export function refusal(error: DbError, known: Record<string, HttpError>): HttpError | null {
  if (error.code === 'P0001' && error.message && Object.hasOwn(known, error.message)) {
    return known[error.message];
  }
  return null;
}

// Name of the constraint a database error mentions, if any.
export function constraintName(error: DbError): string | undefined {
  return /constraint "([a-z0-9_]+)"/.exec(error.message ?? '')?.[1];
}

export const LEAGUE_NOT_FOUND = () => new HttpError(404, 'not_found', "We couldn't find that league.");
