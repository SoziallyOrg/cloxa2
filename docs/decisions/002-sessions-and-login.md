# 002 — Sessions and login per role

**Status:** accepted · 2026-09-28

**Context.** Many users are seniors or not comfortable with technology. Forcing a fresh
login every day on their own phone makes them give up or share accounts. Managers,
though, can see personal data for the whole team.

**Decision**

- **Employees:** passwordless login with an emailed 6-digit code or magic link, and a
  long session on their own device. The Supabase refresh token rotates, with a 30-day
  timebox.
- **Owners, admins and managers:** always `aal2` (TOTP or passkey). The app also
  enforces a 30-minute idle timeout and a 12-hour absolute limit, and re-verifying MFA
  restores access. The rule is enforced in RLS as well, through the `aal` claim.
- **Kiosk (a shared tablet at the entrance):** no personal sessions at all. The device
  token is bound to one site, and employees identify with a PIN or badge (Phase 3).

**Consequences.**

- Supabase session settings are global, so the stricter manager limits live in app code
  and must be covered by tests.
- A lost employee phone keeps working for up to 30 days unless it is revoked. The
  manager gets a "sign out everywhere" action for that employee.
