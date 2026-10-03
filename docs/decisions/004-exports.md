# 004 — Signed exports

**Status:** accepted · 2026-09-29

**Decision.**

- `exports` is append-only: strict `cloxa.export.v1` JSON (RFC 8785), one row per
  employee per Brussels day, ≤62 days, ≤10 MiB, 20/user/hour, 100/org/day. Content
  leaves only via `rpc_record_export_download` (org-bound, audits first).
- The server builds it from RLS reads with `@cloxa/domain`, signs with Ed25519; current
  and retired (`EXPORT_VERIFY_KEYS`) keys at `/.well-known/cloxa-export-keys.json`.
- CSV: BOM, `;`, decimal comma, one line per shift, formula guard, unsigned. No
  secretariat format yet. Ex-employees (no login) get records through their employer.
- Retention: exports live as long as the period they cover (≥5 years, legal §5);
  `private.purge_exports`, granted to no role, deletes older ones and audits.

**Trust model.** The RPC re-checks MFA, scope, period, rows and count, and hashes
itself, but cannot verify Ed25519: a manager calling it directly can store invented rows
for people they see, but not sign them. Downloads refuse and audit bad hashes or
signatures. A signature means only "Cloxa's server built this for user X".
