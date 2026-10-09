import { AuthError, FunctionsHttpError } from '@supabase/supabase-js';

// What the app shows when something fails. Messages come from our own server
// code or from the fixed text below, never from raw library or database
// errors, so nothing internal is shown to users (Appendix A #12).
export type AppError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  ref?: string;
};

export const NETWORK_ERROR: AppError = {
  code: 'network',
  message: "We couldn't reach the server. Check your connection and try again.",
};

export async function fromFunctionError(error: unknown): Promise<AppError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: Partial<AppError> };
      const e = body.error;
      if (e && typeof e.code === 'string' && typeof e.message === 'string') {
        return { code: e.code, message: e.message, fields: e.fields, ref: e.ref };
      }
    } catch {
      // Fall through to the generic message.
    }
    return { code: 'server_error', message: 'Something went wrong on our side. Try again in a minute.' };
  }
  return NETWORK_ERROR;
}

export function fromAuthError(error: AuthError | null, during: 'send' | 'verify'): AppError {
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit') {
    return {
      code: 'rate_limited',
      message:
        during === 'send'
          ? "You've asked for a few codes already. Use the last one we sent, or try again in about 12 minutes."
          : 'Too many tries. Wait a few minutes, then try again.',
    };
  }
  if (during === 'verify' && (error?.code === 'otp_expired' || error?.status === 403 || error?.status === 400)) {
    return { code: 'bad_code', message: "That code didn't work. Check it, or ask for a new one." };
  }
  return NETWORK_ERROR;
}
