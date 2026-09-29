# 009: Public site and pilot requests

**Status:** accepted · 2026-09-29

**Context.** cloxa.app needs a product page, legal pages and a way to onboard the first
customers. The owner decided: onboarding by request, no public self-signup, no billing
yet (a free pilot), everything on cloxa.app.

**Decision.**

- **Pages:** `/` (landing, screenshots from `pnpm screens`), `/aanvragen` (request
  form), `/privacy`, `/voorwaarden`, `/verwerkersovereenkomst` (concept texts, marked
  "nog niet juridisch nagekeken", `[in te vullen]` for company details), `robots.txt`,
  `sitemap.xml`.
- **Requests** live in `private.pilot_requests` (RLS on, no API privileges).
  `rpc_submit_pilot_request` is **service_role only**, not anon: the server action
  checks Turnstile and the honeypot first, and an anon-callable function would let
  anyone skip both with the public key. It limits 3 per email and 10 per IP per 24 h
  (hashes in `auth_attempts`, own hash purposes) and answers the same when limited.
- **Operator mail** (Hostinger SMTP, `nodemailer`) in `after()`, only if all six env
  vars are set. The submitter is never mailed. Requests are deleted after 12 months by
  `run_retention`.
- **Activation is a CLI** (`pnpm ops`), not a web super-admin: a smaller attack surface.
  It invites the contact (Supabase admin invite, Dutch template) and calls
  `rpc_admin_activate_pilot_request`, which wraps `private.create_organization` and
  marks the request. It refuses without `--confirm` and asks for the host when not on
  loopback.
- **Owner:** `create_organization` makes the owner membership active, so the invite only
  creates the login; the invitation-link RPC is not needed.

**Accepted risk.** A stranger can use up an address's 3 requests per day (the same trade
as ADR 003). Requests are unverified: the operator checks them by hand before
activating.
