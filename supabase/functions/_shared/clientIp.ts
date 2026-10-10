// Best-effort caller IP address, used only as a rate-limit key (it is hashed
// before storage and never logged).
//
// Supabase does not document which header carries the real caller address.
// cf-connecting-ip is set by Cloudflare and overwritten if a client sends its
// own, so it is preferred. The fallbacks can be set by the client, so per-IP
// limits are the weaker control: the per-user limits, keyed on the verified
// login token, are the ones that cannot be dodged. Which header the hosted
// project really sends is checked at milestone 1 step 9.
export function clientIp(req: Request): string {
  const candidates = [
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const value of candidates) {
    const ip = value?.trim();
    if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) {
      return ip;
    }
  }
  return 'unknown';
}
