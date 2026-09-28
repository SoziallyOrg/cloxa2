# 005: Kiosk (shared tablet)

**Status:** accepted · 2026-09-29

**Context.** Some staff have no smartphone or email: seniors, horeca, construction. A
tablet at the entrance must let them clock in, without personal sessions and without the
service key in a request path.

**Decision**

- **Pairing.** An owner or admin (fresh MFA) creates a kiosk for one site and gets a
  one-time 8-character pairing code, valid for 10 minutes. On the tablet,
  `/kiosk/koppelen` exchanges it for a 256-bit device secret in an httpOnly cookie
  (`cx_kiosk`, 1 year). The DB stores only `sha256(secret)`. Kiosks can be revoked in
  `/manage`.
- **Calls.** Kiosk RPCs are `public.rpc_kiosk_*`, granted to `anon`. Each one takes the
  device secret, verifies its hash (the device must be active, and the site is bound to
  the device) and does the work SECURITY DEFINER. There is no Supabase session and no
  service key.
- **Identify.** The tablet shows name tiles for employees assigned to that site (display
  name and initials only), and the employee enters a 4–6 digit PIN. The PIN is stored as
  `crypt(pin, gen_salt('bf', 10))`. Employees set it in `/app`; managers can set or
  reset it, which is required for staff without a login.
- **Limits.**
  - 5 wrong PINs per employee in 15 minutes locks that employee's kiosk use for 15
    minutes. A login on their own phone is unaffected.
  - 30 failures per device in 15 minutes pauses the device.
  - Every failure is audited.
- **Facts.** Kiosk events have `source='kiosk'` and `device_id` set to the kiosk, and
  `actor_user_id` may be null (a CHECK allows this only for kiosk). Server time stays
  authoritative. The kiosk never shows hours, only the confirmation, and it returns to
  the tiles after 5 seconds.

**Consequences.** A PIN is weaker than a personal login. The limits bound guessing to
roughly 480 tries per day per employee per device, which is acceptable for a low-value,
audited, correctable fact. Orgs that need more can disable kiosks entirely. No photos
and no biometrics (CLAUDE.md).
