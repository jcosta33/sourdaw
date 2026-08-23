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
- TypeScript or React: `pnpm lint <changed-files>` and the affected typecheck
- A focused test: `pnpm test:run <file-or-narrow-directory>`
- Electron code: `pnpm typecheck:electron`
- Script code: `pnpm typecheck:scripts`
- E2E code: `pnpm test:e2e <spec>` and, when needed, `pnpm typecheck:e2e`
- Rust code: the affected crate's focused `pnpm cargo:test` and
  `pnpm cargo:fmt --package <crate>` checks
- Cross-module TypeScript changes: `pnpm deps:validate`

There is no generic `pnpm test` script. A broad check is not a substitute for
choosing the checks affected by the change.

## Pull requests

Create a focused branch and open a focused GitHub pull request. Complete the
[pull request template](./.github/pull_request_template.md), link the relevant
issue when one exists, and include evidence from the affected checks. Describe
known limitations plainly.

For security issues, use the process in [SECURITY.md](./SECURITY.md), not a public
issue.
