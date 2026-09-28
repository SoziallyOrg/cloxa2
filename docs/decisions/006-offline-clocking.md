# 006: Offline clocking

**Status:** accepted · 2026-09-28

**Context.** Construction sites, cellars and rural shops often have no signal. Today
`occurred_at = server_at` for every live event, so a clock-in that syncs two hours later
would be recorded two hours late. The law asks for an objective, reliable system
(`docs/legal-notes.md` §2), and a phone's clock can be wrong or changed.

**Decision**

- The PWA queues the clock action in IndexedDB, together with `client_captured_at` and
  an idempotency key. The employee sees "Bewaard op je toestel, wordt verstuurd zodra je
  verbinding hebt". The queue syncs on reconnect, when the app opens, and on a timer.
- On sync, `rpc_clock_offline` accepts `occurred_at = client_captured_at` only if all of
  these hold:
  - the time lies in `[server_at − 72 h, server_at]`
  - it is later than the employee's latest effective event
  - the transition is valid
- Such events keep `source='app'` with `offline=true`. Both times are stored and
  chained, so the skew (`server_at − occurred_at`) is always visible.
- If an offline event doesn't fit (a later event exists, the transition is invalid, or
  it falls outside the window), it becomes a **correction request** automatically, with
  reason "Offline geregistreerd", and the manager decides. Nothing is lost and nothing
  is silently rewritten.
- Managers see offline events marked "offline" in the shift lists. A skew above 15
  minutes shows up in "Aandacht nodig".

**Consequences.** A determined employee could set their phone clock back while offline.
Every such event is marked and shows its sync delay, and the manager can correct it. For
orgs that want none of this, offline clocking can be switched off per organisation
(`settings.offline_clocking`, default on).
