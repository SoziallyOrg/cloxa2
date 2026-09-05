# Phase 10A status: reproducible GitHub CI

## Implemented

- `.github/workflows/ci.yml` defines one `verification` job for pull requests to `main`,
  pushes to `main`, and manual dispatches on GitHub-hosted Ubuntu 24.04.
- Workflow has read-only contents permission, branch/PR concurrency cancellation,
  30-minute job timeout, no persisted checkout credentials, no cache, deployment,
  privileged secrets, retries, error suppression, or artifact upload.
- Checkout, Node setup, and pnpm setup actions use full GitHub-verified commit SHAs.
  Runtime is Node 24 with resolved patch printed by CI and exactly pnpm 11.25.0.
- Clean-checkout typecheck precedes formatting, whitespace, lint, local-stack, build, or
  type-generation work. No generated Next.js type workaround was added.
- Disposable local Supabase starts and resets before database, application, build, and
  production browser gates. Audit uses official npm registry and fails on high findings
  or timeout. Browser install uses repository-pinned Playwright 1.62.1.
- `scripts/ci-local-env.mjs` validates repository-local stack, captures structured
  status, creates one ignored mode-`0600` environment file without overwrite, generates
  only fictional credentials, masks runtime values, and preserves Supabase command
  failures.
- `tests/ci-local-env.test.ts` covers valid input, hosted/malformed/missing or
  mismatched refusal, existing-file protection, secret-safe output, and command failure
  propagation using mocked status and temporary files.
- Always-running cleanup deletes generated environment data and stops only local project
  `cloxa2`; it performs no broad Docker cleanup and uploads no runtime evidence.

## Verification model

Full database and browser suites run on each executable GitHub head in documented order.
Local implementation checks cover helper tests, formatting, lint, typecheck, exact diff,
and staged-secret/runtime review. GitHub run URL, resolved Node patch, observed test
counts, and final gate results belong in draft PR description and delivery report,
avoiding a documentation-only commit after CI.

## Known limits

- CI validates only disposable synthetic local data and does not approve production use,
  hosted infrastructure, legal compliance, or deployment.
- Fork pull requests may require repository-owner approval under GitHub policy. Workflow
  provides no privileged credentials and does not bypass that approval.
- Job timeout is 30 minutes. Any timeout, including audit timeout, is an incomplete
  failed gate and must not be reported as success.
