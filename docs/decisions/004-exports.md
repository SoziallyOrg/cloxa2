# 004 — Signed exports

**Status:** accepted · 2026-09-29

**Decision.**

- `exports` is append-only: `cloxa.export.v1` canonical JSON (RFC 8785, integers only),
  one row per employee per Brussels day, ≤62 days, ≤10 MiB. Content leaves only through
  `rpc_record_export_download`, which audits first.
- The web server builds it from RLS reads with `@cloxa/domain` and signs the bytes with
  Ed25519; public keys at `/.well-known/cloxa-export-keys.json`.
- CSV: UTF-8 BOM, `;`, decimal comma, minutes and hours, one line per shift, formula
  guard, no hash line (Excel shows it as data). No secretariat format yet (legal §4).

**Trust model.** The RPC re-checks fresh MFA, site scope, period, row employees and
sites, and row count, and hashes itself, but cannot verify Ed25519. A manager calling it
directly can store invented rows for people they see, but not sign them; downloads
refuse bad hashes or signatures. A signature means only "Cloxa's server built this for
user X"; `clock_events` stays the truth. **Follow-ups:** key rotation, creation limits.
