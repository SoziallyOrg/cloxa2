-- TRUNCATE ignores RLS and does not fire the row-level UPDATE/DELETE guard.
create trigger audit_events_reject_truncate
before truncate on public.audit_events
for each statement execute function private.reject_audit_event_mutation();
