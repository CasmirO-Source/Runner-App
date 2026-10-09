// Response helpers used by every Edge Function.

// Appendix A #46: every response says exactly what it is, browsers must not
// guess the type, and nothing private may be cached by a phone, browser or
// proxy. There are deliberately no CORS headers (Appendix A #27): browsers
// will refuse to let any website call these functions. The app is native, so
// it does not need CORS.
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

// An error that is safe to show to the user. Anything that is not an HttpError
// becomes a generic 500 with a reference code, so internal details never leak
// (PRD 9.4 rule 12, Appendix A #12).
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly headers: Record<string, string> = {},
    public readonly fields?: Record<string, string>,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
