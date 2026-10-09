// Checks done in the app before sending, for quick feedback only. The server
// (zod in the Edge Function) and the database repeat every rule, and they are
// the ones that count (Appendix A #15).
//
// Pure module so it can be unit tested in Node.

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;
const NAME_PATTERN = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/;

export function normaliseDisplayName(raw: string): string {
  return raw.trim().replace(/ +/g, ' ');
}

// Returns an error message, or null if the name looks fine.
export function displayNameProblem(raw: string): string | null {
  const name = normaliseDisplayName(raw);
  if (name.length < DISPLAY_NAME_MIN) return 'Names need at least 3 characters.';
  if (name.length > DISPLAY_NAME_MAX) return 'Names can be up to 20 characters.';
  if (!NAME_PATTERN.test(name)) return 'Use letters, numbers, spaces and underscores only.';
  return null;
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// A loose shape check to catch typos. Supabase Auth does the real validation.
export function looksLikeEmail(raw: string): boolean {
  const email = normaliseEmail(raw);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}
