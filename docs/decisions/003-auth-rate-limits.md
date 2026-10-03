# 003 — Auth rate limits (limiter v3)

**Status:** accepted · 2026-09-28

**Context.** Limiter v2 let strangers lock a known address out, counted successful email
links, and put every client with an unknown IP into one shared bucket.

**Decision.**

- `otp_request`: 3 per email + IP and 20 per IP per 15 min, plus 10 per email per hour.
- `otp_verify`: 5 failures per flow (email + nonce) and 30 per IP; no per-email ceiling.
  Guessing stays bounded: 5 tries per flow, and flows per email by `otp_request`.
- `link_verify`: failures only, 30 per IP per 15 min. Past 300 failures in 10 min, link
  sign-in pauses for everyone and people type the code from the same email instead.
- Unknown IP (`CLOXA_PROXY_MODE=none`, missing or bad header): IP rules are skipped.
- A second verified TOTP factor from a racing `confirmEnrolment` is unenrolled at once;
  `startEnrolment` also removes unverified factors, so abandoned attempts don't pile up.

**Accepted risk.** A stranger rotating IPs can still use up an address's 10 requests per
hour (a sent code keeps working); anyone can trigger the link pause (codes still work).
