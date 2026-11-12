# Review stances

This directory is a lesson library keyed by defect class: the standing probes that catch each
class, and the shared principles that bind them.

## Stance derivation and the lesson library

Stances are derived per task, never selected from this directory. Enumerate the material risks the
diff creates, name one stance per risk, and record each completed draw in `review.json`'s `draws`;
the root `AGENTS.md` Review section carries the rule and the risk plan's floor.

Every completed draw becomes durable evidence: `review:publish` derives the head-bound `dossier-v1`
record from `review.json`, so stance names, models, tiers, and outcomes enter it
([ADR 0054](../../decisions/0054-proportional-machine-checked-review-floor.md)).
Name stances by the failure mode that admits them so that record stays meaningful to a cold reader,
and keep every recorded value single-line and free of credentials or transcript material — the
contract's parsers refuse anything else.

For a fresh plan-carrying publication with findings, each `comments[]` entry declares a non-empty
`sources` array of `{ stance, reviewerModel }` pairs naming the completed draws that independently
detected that finding. Match pairs by both fields; array order does not imply execution order. This
is declared provenance, not proof that a model actually ran. Historical records with unknown
attribution keep it unknown; do not invent sources or rewrite their evidence. The
[document parser](../../../scripts/reviewDocumentParser.ts) and
[publication builder](../../../scripts/reviewDossierPublication.ts) own the validation and compatibility
rules.

This directory is a lesson library, not a menu. Each file collects standing probes and escape
lessons for one defect class, and the matching key is the risk the stance attacks — never the
files the diff touches. A stance carries the most specific matching file and never a broader one
in addition; a stance matching no file dispatches without one. An escape attaches to every file
whose probes participate in what would have caught it, or mints a new file for a defect class
none covers. The directory stays a library reached through the reviewer brief and the index below,
not a loadable skill: stances are derived per task and each reviewer carries exactly the one file
the orchestrator chose, whereas a description-triggered skill would load files by surface match and
turn the library back into a menu.

Every stance file opens with a short lead naming its defect class, then `## Standing probes` as its
first section: a numbered list of five to fifteen probes, each naming the failure mode, the input or
state to drive, the check that must go red, and the mutation that must fail it where the source
lesson established one, with cited issue and PR numbers inline. Keep a file within about 200 lines.
Fold an escape into the probe whose wording would have caught it, keeping its concrete inputs and
mutation and dropping the narrative; add a probe only for a failure mode none names. Retire a lesson
only when a named test or rule enforces it, and record that test or rule under `## Retired lessons`.
A class that cannot carry five honest probes folds into the closest file whose class contains it,
whose lead then names the absorbed class; one that no file contains stays separate and says why
under `## Scope`. When a probe or lesson moves to another file, leave a pointer to its new home (file
and probe number) in a `## Relocated` section, the last section of the file it left.

A reviewer can read the fixed commit and bundle, read PR CI results with read-only `gh`, and run
one focused guarded spec after one targeted mutation through the lane handoff below. It cannot
install dependencies, regenerate WASM or other generated artifacts, run trusted GitHub-write or
delivery scripts, take measurements, run desktop or hardware sessions, run Playwright, or run broad
suites. A probe that needs any of those carries, right after its bold title, exactly one of
`Runs: author.`, `Runs: orchestrator.`, or `Runs: CI; the reviewer reads <job> on the head.`, then
says what the reviewer checks from the fixed commit instead.

## Index

This index is the contract for which file owns which failure mode; adding, merging or retiring a
file updates its line in the same change.

- [ai-request-authority.md](ai-request-authority.md): an AI-originated request reaches project state with authority or protections the user's text never granted.
- [asset-cache-publication.md](asset-cache-publication.md): decoded or durable audio publishes after its target, source or authority changed, or loses residency early.
- [async-file-imports.md](async-file-imports.md): an asynchronous import publishes without its request, project or budget authority, or skips autosave bookkeeping.
- [audio-source-time.md](audio-source-time.md): a reader, edit or saved history selects a different source frame than playback does.
- [audio-timing-format-laws.md](audio-timing-format-laws.md): tempo, parameter-frame, scheduled start or stop, MIDI or format output disagrees with an independent reference.
- [bundled-model-assets.md](bundled-model-assets.md): a packaged model misses emitted weights, loses output windows, or breaks cold worker loading.
- [closure-authority-proof.md](closure-authority-proof.md): a destructive closure acts on an unbound, moved, split or reinterpreted observation.
- [code-craft.md](code-craft.md): a forbidden construct lands with nothing red: baselined file, missing rule, unobserved rule, or widened baseline.
- [collaboration-teardown.md](collaboration-teardown.md): collaboration teardown, backup, handoff or receive-side sync acts on a runtime other than its own.
- [command-entry-and-state-oracles.md](command-entry-and-state-oracles.md): a mutation bypasses Command, half-applies, or overlapping inputs act on state read before an earlier commit.
- [correctness.md](correctness.md): a generic behavior or invariant break; the baseline every reviewer holds, never dispatched by name.
- [guard-reclamation-proof.md](guard-reclamation-proof.md): the guard deletes or retains storage, or settles processes, on partial, stale or denied OS observations.
- [input-monitoring-ownership.md](input-monitoring-ownership.md): capture and monitor owners outlive or lose committed intent, or unproving signals certify recording frames.
- [keyboard-action-accessibility.md](keyboard-action-accessibility.md): a row's main action is pointer-only, sibling actions trigger it, or keyboard focus paints invisibly.
- [maintained-e2e-specs.md](maintained-e2e-specs.md): a browser spec loses its locator or precondition, or runs against a foreign server, origin or build.
- [meter-reading-ownership.md](meter-reading-ownership.md): a destructive meter read lets one consumer drain, borrow or invent another's measurement.
- [moving-coordinate-inverses.md](moving-coordinate-inverses.md): an inverse, Redo, macro or reader recomputes coordinates against a basis the edit moved.
- [project-integrity.md](project-integrity.md): saved, imported, recovered or delivered project truth disagrees with what the musician committed.
- [provider-egress.md](provider-egress.md): provider requests or AI diagnostics leak credentials, misaccount usage, or cross the gateway after cancellation.
- [public-repair-records.md](public-repair-records.md): repair replies or record values are admitted with wrong identity, ordering, serialization, diagnostics or credential material.
- [release-provenance-drift.md](release-provenance-drift.md): a source, literal or merge edit leaves release digests or provenance records stale.
- [rendered-ui-layout.md](rendered-ui-layout.md): rendered layout, paint, contrast or repeated rows differ from what class, state or data implies.
- [replay-authority.md](replay-authority.md): Undo, Redo or a deferred continuation writes over truth other than the one it captured.
- [review-authorization.md](review-authorization.md): review evidence keeps authorizing delivery after its artifacts, live state or token permissions stop supporting it.
- [runtime-instance-lifetimes.md](runtime-instance-lifetimes.md): a continuation acts for a replaced instance, or a lifecycle control reads the wrong state.
- [security-and-platform.md](security-and-platform.md): native authority, renderer trust, installer, toolchain or secret-scan boundaries admit unowned or unverified inputs.
- [session-lifecycle.md](session-lifecycle.md): a transport, scheduler, pump or recording runtime acts for a lifetime the gesture or root no longer owns.
- [startup-entry-availability.md](startup-entry-availability.md): startup leaves a blank document, or recovery repeats effects across a running document.
- [test-observation-scope.md](test-observation-scope.md): a test observes truth in one place, or replaces the boundary its claim depends on.
- [test-timing-and-isolation.md](test-timing-and-isolation.md): a verdict depends on elapsed time, unobserved deadline work, leaked state, or one terminal observation.
- [test-validity.md](test-validity.md): a test passes without observing its subject: unadmitted entry, bypassed route, self-computed oracle, unfalsifiable pin.
- [trusted-script-delivery.md](trusted-script-delivery.md): a trusted script runs through a substitute path, validates an unmerged tree, or overwrites shared Git publication state.
- [validation-scope-selection.md](validation-scope-selection.md): a scope planner, collector or reporter covers different files or jobs than those that run or fail.

## Reviewer isolation

A reviewer reads the fixed commit with `git show <sha>:<path>` and the bundle under
`.agents/review-bundles/<pr>-<sha>/` by default. Review remains blind and independent: findings go
to the orchestrator, never to GitHub, and authors do not judge their own findings. Reviewers never
create a worktree or clone, or install or upgrade dependencies for review.

When a check or mutation probe needs execution, the orchestrator may grant an explicit exclusive
handoff of the author's existing lane. The handoff names the absolute lane, branch, reviewed SHA, permitted
mutation paths, exact checks, and holder. The author stops all writes and check processes before
handoff; only one writer or probe holds the lane at a time. Before execution, the reviewer verifies
the branch and HEAD match the handoff and reviewed SHA and tracked state is clean. Never probe
uncommitted work. Save the original bytes of every planned mutation path before changing it. Use the
lane's existing private install and the prescribed guard and test wrapper; do not install, upgrade,
switch branches, stage, commit, or push.

Wait for the probe and all its processes to exit. Restore only the planned mutation paths from the
saved bytes, then verify their original bytes, branch, HEAD, and clean tracked state before handback.
Leave untracked files and credentials untouched. If any unexpected change appears, stop and report
it without overwriting it. If a handoff or execution is unavailable, report the precise mutation,
named check, and limitation; the orchestrator arranges author execution. An unrun probe is not a
pass, and no alternate worktree or clone is allowed.

Run the probe through `pnpm guard --profile focused -- pnpm test:run <spec>`, never
`pnpm exec vitest run`: the `test:run` wrapper fails a run that collects no case or executes no
assertion, while a bare vitest invocation can exit 0 on an empty collection and read as a pass.

Formatting must select the owned file from the owned checkout. Run the formatter with the lane as
its working directory and lane-relative targets; an external installed formatter binary is fine.
Check its file-info result or output when selection is uncertain. An ignored file or a zero exit
status alone does not prove formatting ran. For a tracked README that ignore rules exclude, an
explicit `--ignore-path /dev/null` is acceptable when targeting only that file.

Each existing checkout that runs pnpm needs its own install rooted in that checkout. Never symlink,
junction, or copy another checkout's `node_modules`: pnpm can overwrite the owner's install records
and abort its next trusted delivery script ([issue #4505](https://github.com/jcosta33/sourdaw/issues/4505)).

Keep the repository's `enableGlobalVirtualStore: false` workspace policy in each checkout. pnpm records
false by default in CI, while an unset local value fails the dependency freshness comparison against
that record. The explicit setting lets the same private install run under both environments with
freshness checking intact. The content-addressed download cache may remain shared; each checkout's
installed virtual tree and ownership metadata stay private. This workspace policy governs the outer
package runner before the trusted launcher; its pinned source snapshot remains a separate boundary.

A probe can fail for environment reasons unrelated to the head. Record the limitation, the named
spec, and the corresponding claim as unverified; the orchestrator must arrange execution where the
environment exists. A mandatory mutation-and-named-spec baseline probe remains undischargeable until
it runs. A spec that derives a `node_modules` or binary path from its file location or working
directory can swallow ENOENT and exit 1 like a head regression; classify from the spec, not the
artifact. `scripts/__tests__/checkProjectLicense.spec.ts` and
`scripts/__tests__/agentDeliveryScripts.spec.ts` are examples.

### Existing legacy probe worktrees

The following cleanup procedure applies only to already existing legacy probe worktrees. It does not
authorize creation of new reviewer worktrees.

Cleanup is controlled by the orchestrator. A reviewer may clean up only the exact probe worktree explicitly assigned in its task; otherwise leave it registered and report its path. For assigned cleanup, first wait until the probe creator, its guard, and every descendant process have actually exited. Verify no process still has its working directory or open files in that worktree. Inspect the exact diff and restore only tracked files changed by that probe's planned mutations, using saved original bytes. Verify each restored path matches its saved original and no unrelated tracked changes remain. Inventory untracked and ignored dependencies, caches, and backups. Preserve probe-owned private files with a same-filesystem move to a unique retained path that does not already exist, and verify the paths, counts, byte totals, and hashes before and after the move. Do not delete them or alter files whose ownership is unclear.

After the restoration and preservation checks pass, unlock only that completed probe worktree, then, from outside it, run ordinary `git worktree remove <path>` without force. If the checks are unclear, restoration or removal fails, or other untracked files remain, stop, preserve the worktree and its contents, and report the exact blocker to the orchestrator. Never use force, `git reset --hard`, `git clean`, `git worktree prune`, or `rm -rf` to get past a cleanup refusal. This procedure is not user approval and does not authorize changing the primary checkout or another agent's worktree; the current task and owner policy govern.

## Review language

Every approval, acceptance, and review body is a review finding written for a human teammate,
not a pipeline log. State what the change does, what was attacked, what held, and any remaining
concerns. The posting identity already carries the authority — never announce the role ("on
behalf of", "as orchestrator", "in the capacity of"). Never cite check counts, hash footers,
or tool-generated provenance artifacts. If the sentence could appear unchanged in a CI log,
it does not belong in a review body.

**Why:** a body that announces the identity chain, cites Gate check counts, and leans on the
generated evidence footer gives a teammate process narration instead of a review. The evidence
already lives in the bundle; the body's job is the finding.
