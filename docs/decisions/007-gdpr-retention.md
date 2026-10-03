# 007: GDPR retention, offboarding and inzage

**Status:** accepted · 2026-09-29

- **Keep facts, remove identity.** Records stay ≥5 years (legal-notes §3, §5); events
  and audit rows hold only UUIDs, so nothing is deleted and both chains keep verifying.
- **Uit dienst** sets `left_at` (≤366 days back, not before the last clock event),
  suspends the membership, signs out everywhere, deletes the kiosk PIN, deactivates;
  "Terug in dienst" undoes it (new PIN needed) until anonymisation. Never an owner or
  oneself; an admin only by the owner; managers only employees. Closing an invitation
  also sets `left_at`.
- **Anonymise** once `left_at` and every fact are older than
  `greatest(retention_years, 5)` years: "Voormalig medewerker xxxxxx", no code, reasons,
  PIN or invitation email; membership removed; auth user deleted when no membership
  remains.
- **Job:** `private.run_retention()` (no role) anonymises and purges exports per org,
  each org isolated, counts-only audit rows. pg_cron `15 1 * * *` UTC = 03:15 Brussels
  in summer, 02:15 in winter. Hosted Supabase: enable pg_cron, run the `cron.schedule`
  line from the migration once.
- **Inzage:** `rpc_subject_export` (owner/admin, fresh MFA), `rpc_my_data_export`
  (self): audited JSON, `attachment`, `no-store`, no hashes. For a manager or admin it
  includes audit rows they wrote, which name others by UUID only.
- **Residual:** stored exports keep names until purged; clock `geo` stays with facts.
