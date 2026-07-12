---
type: adr
id: 0005
title: Treat large public samples as an explicit distribution artifact
status: accepted
date: 2026-06-28
owner: The Sourdaw team
sources:
  - specs/sample-library/spec.md
  - specs/browser-ddsp-instruments/spec.md
---

# 0005 — Treat large public samples as an explicit distribution artifact

## Context

The artifact-remediation branch added a guard so agents and CI do not
accidentally refresh or expand `public/samples/levain`. It did not delete, move,
or repackage the already tracked sample payload because repository safety rules
require explicit human instruction naming paths before deletion or relocation.

The remaining decision is whether the full Levain sample library belongs in
ordinary Git source, Git LFS, release artifacts, or runtime download/cache.

## Decision

Use a two-tier sample distribution model:

1. Keep only a minimal deterministic fixture set in ordinary Git for tests,
   examples, and offline smoke flows.
2. Treat full production sample libraries as distribution artifacts: Git LFS,
   release assets, signed CDN/object-store downloads, or first-run runtime cache.
3. Do not delete or move the existing tracked files until a human explicitly
   chooses the target path and names the files or directories to migrate.

## Non-goals

- Do not delete, move, or repackage the current tracked sample tree in this
  decision record.
- Do not make tests or offline smoke flows depend on network access.
- Do not choose a specific commercial storage provider here.

## Open questions

- Which artifact channel should carry full production sample libraries: Git LFS,
  release assets, signed CDN/object-store downloads, or first-run runtime cache?
- What is the minimal fixture set required to preserve tests, demos, and offline
  smoke coverage?
- Which migration command and rollback plan should move existing tracked samples
  once the target channel is chosen?

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep all large sample payloads in ordinary Git indefinitely | It keeps clone, checkout, packaging, and agent worktree costs dominated by generated media content. |
| Delete the sample tree during remediation | It violates repo safety rules and may break existing demos/tests without a replacement distribution path. |
| Move directly to runtime download without a fixture set | It risks making tests and offline smoke flows depend on network availability. |

## Consequences

- Positive: the repository can stay small and testable while production samples
  remain available through an intentional distribution channel.
- Negative: the team must choose and maintain an artifact distribution mechanism.
- Neutral: the existing download guard remains useful regardless of whether the
  final artifact channel is LFS, release assets, CDN, or runtime cache.

## Status

accepted

## Follow-up work

Future implementation work must choose the concrete artifact channel, define
the minimal checked-in fixture set, and perform any migration only after
explicit path-level approval.

## Affected requirements

- `SPEC-sample-library#AC-015` — sample-library root flows need stable display and fixture behavior.
- `SPEC-browser-ddsp-instruments` — bundled and downloaded sample assets need explicit packaging rules.
