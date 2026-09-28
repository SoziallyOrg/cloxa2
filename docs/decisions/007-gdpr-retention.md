# 007: GDPR retention, offboarding and inzage

**Status:** accepted · 2026-09-29

- **Keep facts, remove identity.** Records stay at least 5 years (legal-notes §3, §5).
  `clock_events` and `audit_log` hold only UUIDs, so nothing is deleted and both chains
  keep verifying.
- **Uit dienst:** `rpc_offboard_employee` sets `left_at`, suspends the membership, signs
  out everywhere and deactivates (audited); `rpc_reinstate_employee` undoes it until
  anonymisation. Never an owner or oneself; managers only role `employee`.
- **Anonymise** once `left_at` and every fact are older than
  `greatest(retention_years, 5)` years: "Voormalig medewerker xxxxxx", no code, reasons
  and notes cleared, PIN and invitation email gone, membership removed, auth user
  deleted if no membership remains.
- **Job:** `private.run_retention()` (no role may run it) anonymises and purges exports,
  one counts-only audit row per org. pg_cron `15 1 * * *` UTC = 03:15 Brussels (summer),
  02:15 (winter). Without pg_cron the migration applies with a notice; on hosted
  Supabase enable pg_cron and run the migration's `cron.schedule` line once.
- **Inzage:** `rpc_subject_export` (owner/admin, fresh MFA), `rpc_my_data_export`
  (self): one audited JSON attachment, `no-store`.
- **Residual:** stored exports keep names until the export purge; clock `geo` points
  stay with the facts.
