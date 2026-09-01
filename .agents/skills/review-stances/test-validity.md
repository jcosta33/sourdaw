# Review stance: test validity

Dispatch guidance for the test-validity stance. Per the Review section of `AGENTS.md`, an escape —
a defect that reached `main` which this stance should have caught — is recorded here as a lesson,
and every future dispatch of this stance carries this file's lessons. Lessons state the escape, the
blind spot, and the probe that would have caught it. Keep each lesson short enough to paste into a
dispatch.

## Standing probes

- Apply the standard mechanical probe the Review section of `AGENTS.md` defines; this file does not
  restate it.
- A spec-only diff that turns red to green is the highest-risk diff class: for every hunk, read the
  product code the spec observes at head and decide stale-spec versus laundered defect.
- Exact-count and exact-shape assertions: verify the pinned value derives from the thing it claims
  to observe, not from whatever the code currently produces.
- A diff that adds an export to a contract barrel, or adds a barrel import to production code,
  changes what every spec mocking that barrel must supply. Sweep them.

## Lessons from escapes

### 2026-08-29 — a refactor that rewrites its own witnesses (escaped via PR #2988)

PR #2988 extracted render-retry execution, claimed in its body that it kept exact revision, budget,
continuation, chat, and no-replay behavior, and in the same diff rewrote its own handler spec's
call-count assertion from a two-pass pin to a single-flight pin — an observable contract change
shipped under a preservation claim. Two end-to-end witnesses (`drumBusPromptWorkflow`,
`backingVocalPlateWorkflow`) were edited by that same diff yet only partially realigned: their
stale attempt-count expectations survived the edit and were left failing on `main`, diagnosed from
scratch later (#3060).

Blind spot: the stance checked that the diff's own specs discriminate, but not that the diff's spec
edits were consistent with the body's preservation claim — and in files the diff touched, partial
realignment passed as realignment; assertions the diff left standing in edited files were never
re-checked against the new behavior, and untouched witnesses of the same surface were never run.

Probe that would have caught it: when a refactor's body claims behavior preservation, diff every
assertion the refactor itself rewrites — a changed expected value under a preservation claim is a
contradiction to raise, not context to accept; in every spec file the diff touches, re-check the
assertions it did NOT change against the new behavior; and search the repository for other specs
observing the same call surface, running the nearest ones.

### 2026-08-29 — a barrel mock the diff silently invalidated (escaped via PR #3098)

At PR #3098's first head, production code grew an import from the `#/modules/AudioEngine/useCases`
barrel. A sibling spec, `src/modules/Transport/useCases/__tests__/playheadScheduler.spec.ts`, mocks
that barrel with an explicit factory that lists its keys instead of spreading the original, so the
new key resolved to `undefined` and 14 of that spec's 23 tests failed on the head. The pull
request's gate stayed green — the unit legs are softened on pull requests — no stance raised it, and
the author found it by running the spec.

Blind spot: the stance read the diff's own specs and the specs of the files the diff edited. A
`vi.mock` factory in an unedited file is a contract with a barrel, and a diff that widens what
production code takes from that barrel breaks that contract without appearing in the diff at all —
nothing in the changed lines points at the spec that now fails.

Probe that would have caught it: when a diff adds an export to a barrel, or adds a barrel import to
production code, grep the repository for specs mocking that barrel; for each, decide whether its
factory spreads the original or lists keys, and whether the spec transitively executes the changed
production path. A listing factory on an executed path is the finding, named with the missing key
and the spec that will fail. Never read a green gate as the answer here: the unit legs are softened
on pull requests, so this failure class reports as a warning annotation rather than a red check.

### 2026-08-30 — a vitest-green spec whose types fail the strict build (escaped both stances via PR #3127, caught only by the pipeline)

PR #3127's new census spec passed its focused vitest run and both blind stances cleared it, but its
`import.meta.glob` value handling failed the strict test typecheck (TS2322/TS2769 under
`noUncheckedIndexedAccess`); only the pipeline's Types-and-contracts job caught it.
The same class hit PR #3120 (a production WeakMap typed too narrowly for a new field, TS2339) —
vitest transpiles without typechecking, so a green run is never type evidence.

Blind spot: the stance proves specs discriminate by running them; vitest's pass says nothing about
the strict `tsc` contracts the pipeline enforces, so a PR adding TypeScript files can carry type
errors no spec-level probe surfaces.

Probe that would have caught it: when a diff adds or edits TypeScript files, compile a narrow `tsc`
program in /tmp (extend the lane tsconfig with strict options, include the changed files plus the
ambient types the import closure needs) and require exit 0; reproduce the failure pre-fix when
validating a posted type finding. (PR #3136's dispatch already carried this probe and produced clean
heads.)

### 2026-08-30 — a new device type string that is a classified third-party mark (escaped via PR #3127, caught by the release-inventory job)

PR #3127 inlined preset chains whose faust device types carry trademark strings;
`faust-1176-compressor` tripped the release inventory's mark census (unclassified mark path),
failing the pipeline's Release-inventory step. Five sibling files were already classified in
`release/open-source-inventory.json`.

Blind spot: no stance treats the repository's artifact-contract checks (release inventory marks,
dependency-license proofs) as part of the diff's blast radius; a new string constant in a type/name
registry can violate a data contract no spec observes.

Probe that would have caught it: when a diff adds type or name strings to registries (device types,
plugin descriptors, preset ids), run `pnpm test:release-inventory` in the lane (cheap, ~10s) or at
minimum grep the added strings against `release/open-source-inventory.json`'s marks values; classify
any hit in the same change.
