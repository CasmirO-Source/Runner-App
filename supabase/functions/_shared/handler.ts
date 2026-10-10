import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

import { requireUserId } from './auth.ts';
import { clientIp } from './clientIp.ts';
import { HttpError, json } from './http.ts';
import { log } from './log.ts';
import { ANY_FUNCTION_PER_IP, ANY_FUNCTION_PER_USER, enforceRateLimit, type RateLimit } from './rateLimit.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';

// Largest request body accepted by default. Real requests are a few hundred
// bytes. A function that needs more (the screenshot reader) says so itself.
const DEFAULT_MAX_BODY_BYTES = 8 * 1024;

export type HandlerContext<T> = {
  userId: string;
  input: T;
  admin: SupabaseClient;
};

export type HandlerResult = { status: number; body: unknown };

type Options<S extends z.ZodType> = {
  name: string;
  schema: S;
  // Extra per-user limits for this function, on top of the global ones.
  limits?: RateLimit[];
  // Largest body this function accepts, in bytes. Defaults to 8 KB.
  maxBodyBytes?: number;
  handle: (ctx: HandlerContext<z.output<S>>) => Promise<HandlerResult>;
};

// Every Edge Function is built with this wrapper, so every one runs the same
// checks in the same order. The order matters: cheap refusals come first, and
// nothing touches the function's own logic until the caller is known, within
// their limits, and has sent exactly the expected input.
//   1. POST only. Anything else, including browser CORS preflights, is refused.
//   2. Per-IP rate limit, before even checking the token, so floods of junk
//      tokens are cut off early.
//   3. Verified login token gives the user ID (never the request body).
//   4. Per-user rate limits.
//   5. Body: JSON only, size-capped, then a strict zod schema that rejects any
//      unexpected field (PRD 9.2 rule 6, Appendix A #16).
//   6. Only then the function's own code runs.
// Any unexpected error becomes a generic message with a short reference code.
// The log gets the same code plus the error type, never the error message.
export function createHandler<S extends z.ZodType>(options: Options<S>) {
  return async (req: Request): Promise<Response> => {
    const ref = crypto.randomUUID().slice(0, 8);
    try {
      if (req.method !== 'POST') {
        throw new HttpError(405, 'method_not_allowed', 'That is not allowed.', { Allow: 'POST' });
      }

      const admin = supabaseAdmin();
      await enforceRateLimit(admin, ANY_FUNCTION_PER_IP, clientIp(req));

      const userId = await requireUserId(admin, req);
      await enforceRateLimit(admin, ANY_FUNCTION_PER_USER, userId);
      for (const rule of options.limits ?? []) {
        await enforceRateLimit(admin, rule, userId);
      }

      const input = await parseBody(req, options.schema, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
      const result = await options.handle({ userId, input, admin });
      return json(result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) {
          log('warn', { fn: options.name, ref, event: err.code, status: err.status });
        }
        return json(
          err.status,
          { error: { code: err.code, message: err.publicMessage, fields: err.fields, ref } },
          err.headers,
        );
      }
      log('error', {
        fn: options.name,
        ref,
        errorType: err instanceof Error ? err.name : typeof err,
        dbCode: typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : undefined,
      });
      return json(500, {
        error: {
          code: 'server_error',
          message: `Something went wrong on our side. If it keeps happening, quote reference ${ref}.`,
          ref,
        },
      });
    }
  };
}

async function parseBody<S extends z.ZodType>(req: Request, schema: S, maxBytes: number): Promise<z.output<S>> {
  const type = req.headers.get('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'That request was not in the right format.');
  }
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) {
    throw new HttpError(413, 'too_large', 'That request was too large.');
  }
  const text = await readCapped(req, maxBytes);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'That request was not in the right format.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Field messages are written by us in the schema, so they are safe to
    // show. Unknown fields get one generic message, without echoing them back.
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = typeof issue.path[0] === 'string' ? issue.path[0] : null;
      if (key && issue.code !== 'unrecognized_keys' && !fields[key]) {
        fields[key] = issue.message;
      }
    }
    throw new HttpError(400, 'invalid_input', 'Some details need fixing.', {}, fields);
  }
  return parsed.data;
}

// Reads the body piece by piece and stops as soon as it passes the cap, so a
// sender who leaves out Content-Length (or lies in it) cannot make the
// function hold an oversized body in memory.
async function readCapped(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', 'That request was too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
