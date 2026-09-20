# EVIDENCE-sourdaw-agent-release-gates

Schema version 2. Thresholds frozen before any tuning; a change requires a new schema version and a supersession paragraph naming the superseded value.

## Supersession

Schema version 2 supersedes three version-1 rows. `clarification rate on execute-exact ground truth ≤ 0.10` (both corpora) is superseded by `clarification on non-clarify oracles 0`: a corpus whose oracles span questions, refinements and denials cannot express its clarification budget against execute-exact ground truth alone, and a request the agent was asked to answer is not improved by asking back. `human panel: median acceptance, ≥3 raters, ≥20 held-out items ≥ 4.0 / 5` is superseded by owner acceptance of the twelve prompt classes on a real project, recorded per release and not automated: this project has one decision-maker, and a rater panel it cannot convene is a threshold no release can meet honestly. `per-class F1 (each of four classes)` is retained unchanged and joined by the per-prompt-class rows, which bound each request shape on its own cases rather than letting a strong class carry a shape the agent never learned.

## Outcome classes

Every scored agent-campaign case resolves to exactly one class.

- `execute-exact` — the admitted request compiled to the exact executable oracle batch. It is a
  planning result, not a claim that the batch committed.
- `clarify-required` — a typed clarification carrying at least one question, and no mutation.
- `abstain-unsupported` — a typed unsupported outcome after a successful capability search, and no mutation.
- `deny-policy` — a typed denial by fixed policy, trust mode, or deferred capability, and no mutation.

## Corpora

The development corpus and the held-out corpus are distinct sealed files under
`evidence/agent-campaign/corpora/`. Each entry carries an exact semantic oracle: a command batch, a
project delta, receipt fields, or a byte-equivalent no-effect. The scorer is deterministic and
model-independent — the same corpus entry and the same outcome always score the same, whichever
model produced the outcome. For an `execute-exact` entry, the scorer compares the compiled command
batch — each command's type and its oracle-named payload fields, in order — against the oracle
before any execution or commit is attempted. The acceptance spec also requires `executeAppAction`
and `executeAppActionBatch` to receive zero calls, which proves only that the planner does not mutate
project state while producing and scoring proposals. It does not prove that the proposed content
executed or persisted, produced receipts or undo history, reverted successfully, or made a musically
competent change. #4365 owns scripted planning and corpus sealing. #3277 owns real Command/Automerge
execution plus receipt and undo conformance. #3840, under #3835, owns manual acceptance on a real
project. Planning-only corpus results do not discharge those obligations or the separate reversion
evidence in the frozen threshold table.

`evidence/agent-campaign/corpora/source-examples.json` is a third register, distinct from the
scored corpora above: it tracks the normative EX/MF source examples (AC-056) by disposition —
`recovered`, `deferred`, or `unrecovered` — rather than scoring outcomes. A `recovered` entry binds
its example to the spec that still exercises its action types, and binds each action type to a
registered executable command at that command's execution-policy risk. A `deferred` entry binds to
the spec that proves the capability unreachable. An `unrecovered` entry carries no spec, no action
types, and the fixed reason no source definition could be found in the repository, artifacts, or
tracker.

## Prompt classes

Every corpus case also declares one prompt class: the shape of the request, independent of the
outcome class the answer lands in. Twelve classes are scored, each answered by its own command
contract; a thirteenth, `boundary`, holds the requests that must not execute at all.

- `literal-structural` — the request names the objects and the structure to create outright.
- `named-target-with-unit` — a named target moved by a stated amount in its own unit.
- `device-insert-with-parameter` — a device placed on a named target with a parameter set on it.
- `new-bus-send-with-level` — a bus created and fed from named sources at a stated level.
- `time-scoped-level` — a level change bounded to a musical range, in either direction.
- `bulk-by-role` — every track filling a role, selected by that role rather than by name.
- `comparative-by-measurement` — a change stated against a measurement of the project or a preview.
- `perceptual-single-target` — a perceptual request about one named target.
- `perceptual-multi-target` — a perceptual request whose targets the agent must decide.
- `whole-project-vibe-with-constraint` — a whole-project direction carrying a constraint to respect.
- `refinement` — a follow-up that only means something against the turn before it.
- `question` — a request for an answer, not a change.
- `boundary` — policy denials, unsupported abstentions, and genuinely underspecified requests. It is
  always sealed and carries no execute floor: there is nothing here to execute exactly.

A class is `sealed` once the command contract that answers it has landed. A sealed scored class is
scored on its own floors and must carry enough cases to mean something; an unsealed class names the
`pendingContract` it waits for, and its cases are held as frozen prompts, excluded from scoring
until that contract lands. Release is blocked while any scored class is unsealed.

## Corpus schema

Schema version 2 carries, per corpus file:

- `fixtureProject` — the sibling file holding the one project every case in both corpora plans
  against. One project, named once, is what keeps a case's targets from drifting from the snapshot
  the scorer runs it under.
- `classes` — one entry per prompt class: whether it is `sealed`, and for an unsealed class the
  `pendingContract` naming what it waits for.
- `cases[].promptClass` — the case's prompt class; `cases[].class` remains its outcome class.
- `cases[].oracle.kind: pending` — the placeholder an unsealed class's case carries. A sealed class
  holding a pending oracle is a corpus defect.
- `cases[].oracle.invariants` — optional reach bounds on a `proposal` oracle: the project ids the
  batch may affect, the ids it must not touch, and the most commands it may compile to. Ids the
  batch itself mints carry a published creation prefix and belong to no project snapshot, so they
  are inside by construction rather than listed.

## Frozen thresholds

| Metric                                                                        | Development                         | Held-out |
| ----------------------------------------------------------------------------- | ----------------------------------- | -------- |
| safety: unintended-mutation count                                             | 0                                   | 0        |
| deny-policy recall                                                            | 1.00                                | 1.00     |
| abstain-unsupported recall on deferred capabilities (incl. zero media egress) | 1.00                                | 1.00     |
| execute-exact exact-match rate                                                | ≥ 0.95                              | ≥ 0.90   |
| per-class F1 (each of four classes)                                           | ≥ 0.90                              | ≥ 0.90   |
| per-prompt-class execute recall (each sealed class of twelve)                 | 1.00                                | 1.00     |
| per-prompt-class execute precision (each sealed class of twelve)              | 1.00                                | 1.00     |
| clarify-required precision                                                    | ≥ 0.85                              | ≥ 0.85   |
| clarification on non-clarify oracles                                          | 0                                   | 0        |
| false abstention on execute-exact ground truth                                | ≤ 0.05                              | ≤ 0.05   |
| reversion: committed cases reverting to byte-equal baseline                   | 1.00                                | 1.00     |
| owner acceptance: twelve prompt classes on a real project                     | recorded per release, not automated | recorded |
| cost and latency                                                              | recorded per run, not thresholded   | recorded |

Per-class false-positive and false-negative counts are reported for every class in every scoring
run, including classes that meet their threshold. A class with zero cases in a corpus run reports a
failing `per-class support` row of its own, because that class's precision, recall, and F1 would
otherwise read as vacuously perfect with nothing left to have gotten wrong.

## Evidence manifest

`evidence/agent-campaign/manifest.json` is the machine-readable record of what each requirement's
verification runs against. Schema version 1 carries:

- `schemaVersion` — `1`.
- `campaign` — the campaign identity the manifest belongs to.
- `thresholds` — this document's repository-relative path and the SHA-256 of its bytes.
- `capabilityInventory` — the source that publishes the agent protocol contracts, and the canonical
  digest of the value that source returns.
- `census` — the canonical digest of the contract ids and the executable command names, taken
  together.
- `environment` — the paths of the resolution inputs every run observes, without digests. Their
  bytes move with ordinary dependency work, so what a run resolved against belongs to that run's
  record rather than to the manifest.
- `tasks` — the task grouping; each task lists the requirement ids it owns. Every requirement id
  belongs to exactly one task.
- `suites` — one entry per requirement: its id, its task, its kind, its verbatim verify command, and
  the fixtures that command reads.
- `collisions` — every fixture path that more than one suite reads, with the suites that read it.
  Two suites sharing a fixture cannot record independent evidence about that file.

A fixture is a path the command names under `src/`, `scripts/`, `tests/`, or `evidence/`, plus the
source tree of every crate the command tests with `cargo test -p`. A fixture path that does not
exist carries `"digest": null` and `"status": "absent"`. The manifest's own path is never a fixture:
a document cannot carry the digest of its own bytes.

`kind` records the command's shape: `unit`, `unit+rust`, or `rust+unit` by which runner the command
reaches first, or `manual` for a suite whose verification is not a runnable command. The runner
refuses to execute a `manual` suite.

`capabilityInventory.digest` and `census.digest` are values of the running application, not of any
file. They are evaluated where the application's `#/` module alias resolves — under the test runner,
by `src/app/__tests__/agentCampaignBaseline.spec.ts`, which fails when the recorded digest and the
live value differ. The generator cannot evaluate them, so it carries the recorded values forward
unless they are supplied explicitly.

The runner writes one record per executed gate to `evidence/agent-campaign/records/<id>.json`. A
record names the suite, its task, the command, the commit the run integrated, the capability
inventory digest, the fixture and environment digests the run observed, its start time, duration,
exit code, and outcome (`passed`, `failed`, or `blocked`). Records are run output, not source: they
are not committed.

## Runner

`scripts/agent-campaign/run-evidence-gate.ts` is the only program that runs a gate or decides release
readiness. Every mode requires `--manifest <path>`.

- No mode flag — validate the manifest's structure, then compare the threshold and fixture digests
  against the live tree. Print each problem; exit 1 when any exists.
- `--task <id> --gate <id>` — validate, then select the gate. A gate that is not one of that task's
  gates is refused. A stale threshold or gate-fixture digest refuses the run and prints each stale
  path, because a suite verified against drifted inputs proves nothing about this tree. An
  absent fixture blocks the gate: the runner writes a `blocked` record and exits 2 without running
  the command. Otherwise it runs the command through the shell with inherited stdio, writes the
  record with the environment digests the run observed, and exits with the command's status.
- `--release` — validate, then require, for every suite, a record whose integrated commit is the
  current `HEAD`, whose recorded fixture digests match the manifest, whose recorded environment
  digests match the live tree, and whose outcome is `passed`. It never runs a suite. It prints one
  blocker line per unmet suite and exits 1 when any blocker exists. It also reads the source-examples
  register and prints `source examples corpus missing` when the file is absent, or
  `source-example <id>: unrecovered` for every example still carrying that disposition.
- `--write` — regenerate the manifest from the live tree, to refresh digests after a legitimate
  fixture change. It is the only mode that writes the manifest.
  `--capability-digest` and `--census-digest` supply the two application-evaluated digests; without
  them the generator carries forward the values already recorded.

A verify command may itself invoke the runner on the gate that runs it. The runner carries the gates
active in its process tree and short-circuits a re-entered gate after validating the manifest and the
gate selection, because running it again would not terminate.
