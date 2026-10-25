# Contributing to Sourdaw

Sourdaw is early-stage software. Small, focused changes are easier to review and
less likely to make the DAW behave like a different DAW by accident.

## Contribution rules

- Keep each change focused and explain the user-visible behavior or invariant it
  changes.
- Preserve real-time audio safety, project integrity, deterministic undo, and
  existing module boundaries.
- Do not include credentials, generated bundles, private project files, or other
  local-only material in a contribution.
- Update public documentation when a supported behavior or limitation changes.

## Checks

Run only checks that can fail because of the files you changed. Examples:

- Markdown or other formatting: `pnpm format <changed-files>`
- TypeScript or React: lint and typechecks run in pull request CI; do not run them locally.
- A focused test: `pnpm test:run <file-or-narrow-directory>`
- Electron code: the pull request's CI typechecks the desktop code.
- Script code: the pull request's CI typechecks the scripts.
- E2E code: `pnpm test:e2e <spec>` locally; the pull request's CI typechecks E2E code.
- Rust code: `pnpm cargo:test --package <crate> <filter>` and
  `pnpm cargo:fmt --package <crate>`
- Cross-module boundaries, repository builds, and broad test suites: use the pull request's CI checks.

There is no generic `pnpm test` script. A broad check is not a substitute for
choosing the checks affected by the change.

## Pull requests

Create a focused branch and open a focused GitHub pull request. Complete the
[pull request template](./.github/pull_request_template.md), link the relevant
issue when one exists, and include evidence from the affected checks. Describe
known limitations plainly.

For security issues, use the process in [SECURITY.md](./SECURITY.md), not a public
issue.
