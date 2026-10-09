# Supabase dashboard settings

Settings that live in the Supabase dashboard rather than in migrations. The
local stack reads the same values from `supabase/config.toml`; keep the two in
step. Apply these to the development project now and to production in
milestone 9. Tick each one when done.

## Account security

- [ ] Two-factor login switched on for every account that can open the Supabase dashboard (Appendix A #45).

## Authentication > Sign In / Providers

- [ ] Email provider: on.
- [ ] Allow new users to sign up: on.
- [ ] Confirm email: **on**. Supabase cannot switch password sign-in off, so this makes sure a password sign-up made directly through the API cannot be used until the person proves they own the address.
- [ ] Anonymous sign-ins: off.
- [ ] Manual linking: off.
- [ ] Every other provider (phone, Apple, Google, others): off. Apple and Google come in milestone 3.
- [ ] Minimum password length: 12. Password requirements: lowercase, uppercase, digits and symbols. (The app never uses passwords; this only hardens the API route that cannot be switched off.)
- [ ] Secure email change (both old and new address must confirm): on (Appendix A #24).

## Authentication > Email

- [ ] Email OTP expiration: **600** seconds (Appendix A #4).
- [ ] Email OTP length: **6**.
- [ ] Minimum interval between emails to the same user: **12 minutes**. That caps sign-in codes at 5 per hour per email (PRD 9.3).

## Authentication > Email templates

Set **both** "Confirm signup" and "Magic Link" to:

- Subject: `Your sign-in code`
- Body: the contents of `supabase/templates/sign-in-code.html`.

The email shows the code only. There is no link, so there is nothing to phish with a look-alike link, and the app never needs to handle sign-in links.

## Authentication > Rate limits

- [ ] Sign-ups and sign-ins: **2 per 5 minutes per IP** (at most 24 an hour; the PRD asks for 20 an hour and Supabase counts in 5-minute steps).
- [ ] Token verifications: **10 per 5 minutes per IP**.
- [ ] Token refreshes: leave at the default (150 per 5 minutes per IP).

## Authentication > Sessions

- [ ] Access token (JWT) expiry: **3600** seconds (Appendix A #25).
- [ ] Refresh token rotation: **on**, reuse interval 10 seconds.

## Project settings > JWT keys

- [ ] Use Supabase's generated asymmetric signing keys (not a hand-typed secret). Development and production must have different keys (Appendix A #26).

## Project settings > API keys

- [ ] The app's `.env` holds the publishable (or legacy anon) key only. The secret and service role keys are never copied anywhere: Edge Functions receive them automatically.

## Project settings > Data API

- [ ] Exposed schemas: `public` only. Remove `graphql_public`.

## Notes

- Built-in email (no custom SMTP) only delivers to members of the Supabase team. In development that acts as the allow-list of test accounts (Appendix A #29). Production needs its own email provider (milestone 9 decision).
