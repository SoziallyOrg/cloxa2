# 010: Manager-initiated corrections

**Status:** accepted · 2026-10-03

**Context.** "Oplossen" and "Correctie toevoegen" led nowhere; kiosk-only staff could
not get a forgotten clock-out fixed.

**Decision.** `rpc_manager_correct` writes a `correction_requests` row with
`origin = 'manager'` and approves it through `decide_correction` in one transaction,
under the employee lock and a share lock on the employee row. No new event source, no
hash-chain change. Fresh MFA, scoped per employee, same validation as a request, reason
mandatory, no pending cap, at most 60 per actor per hour. Managers correct employees (or
staff without a login) only; only an owner corrects an owner or their own record
(`self_decided`). The employee reads the row; `origin` is immutable and exported.
Approval of any request (also an employee's own) now needs an active employee; rejection
still works, so pending requests of someone who left can be closed.

**Open.** `legal-notes.md` wants records not "silently editable by the employer": we
rely on visibility, reason and audit; notification and contest are future work. An admin
could correct a login-less row they clock on themselves (the audit names them). People
who left cannot be corrected (no grace window), scope covers all of an employee's sites,
and the inspection export has no correction history.
