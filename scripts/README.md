# Local Auth fixtures

Keep the three Supabase URL/key settings in ignored `apps/web/.env.local`, using values
from this repository's running local stack. Never put hosted credentials there.

Generate missing fictional credential settings without displaying their values:

```bash
pnpm local:credentials --confirm-local-development
pnpm local:bootstrap --confirm-local-development
```

Credential generation preserves existing content and values. It refuses non-ignored,
symlinked or nonregular files, duplicate variable names, empty fixture settings, and
keys or URLs that do not match the local stack. Remove blank fixture-variable lines from
a copied `.env.example`, or fill them yourself before running the command. Manager email
uses `example.test`; three independent random passwords stay in the ignored file. No
values are printed.

Bootstrap creates one fictional manager, organization, Brussels worksite and active
manager membership. Reruns neither reset passwords nor overwrite conflicting records.
E2E adds unique fictional employees; no broad account or inbox cleanup runs. Resetting
the local database removes local fixtures when explicitly requested.

Playwright runs on `127.0.0.1:3100`, retrieves invitation and recovery mail from local
Mailpit, and disables traces, screenshots, video and retained test artifacts. Build
automatically scans production browser bundles for server-secret leakage. Pinned
Playwright's automatic failure DOM snapshots are disabled too, keeping form values out
of error reports. Browser requests allow only the local app and Auth API.

Correction journeys use fresh synthetic employees and authenticated RPCs for factual
clock records and correction mutations. Parallel tests use two independent live sessions
to exercise retry, overlap, and withdrawal races. Service credentials create fixtures
and inspect outcomes only; they never write factual time or correction rows.

For local UI review only, `CLOXA_CAPTURE_REVIEW=1` captures the correction page after
its synthetic journey into ignored `.impeccable/review/desktop.png` and `mobile.png`.
These captures exclude Auth forms, passwords, cookies, and links. Normal E2E runs keep
capture disabled; review images never enter Git.
