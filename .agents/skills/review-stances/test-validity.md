# Lesson library: test and evidence validity

Lesson library for test and evidence validity. Per the Review section of `AGENTS.md`, this
directory is a lesson library, not a stance menu: an escape — a defect that reached `main` whose
defect class matches this file — is recorded here as a lesson, and every dispatch whose derived
stance matches this file carries its lessons. Lessons state the escape, the blind spot, and the
probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

### 2026-10-10 — a required Rust job fetched its compiler before its caches (introduced by PR #3119)

The required Linux Rust job ran `rustup show` before any cache restore. PR #5064 run 38022076992
failed on a Rust distribution metadata TCP timeout before rustfmt or any health gate ran. Cargo
dependency caches after setup could not affect that failure. The missed CI runtime stance treated a
later green Rust job as evidence of recovery without proving its compiler setup path had changed.

Probe that would have caught it: trace the first compiler invocation and place an exact host-and-
TOML-keyed installed-toolchain restore before it. With the distribution endpoint unavailable,
require a complete exact hit to run rustc, rustfmt, and clippy with automatic installation disabled;
require a mismatched or incomplete hit to fail closed, and a cold install error to fail before Cargo
caches and health gates. A local fake endpoint proves the wiring only; hosted proof needs the
actual seeded main cache and a new-head required Rust run.

### 2026-10-09 — authority tests fixed PR state for the whole run (introduced by PR #4586)

PR #4586 introduced the authority append with a publication fixture whose PR reader always
returned `OPEN` at the same head. Its recorded test-validity stance asked whether reverting the
writer would stay green, but did not mutate PR state after approval inspection. PR #5032 extended the
same binder to recovery; its moved-head fixture changed the head before reconciliation and held
it constant through the two inspections and later dossier write.

Probe that would have caught it: make the first two inspections return the same open head, then
return merged, closed, or another head on the next PR read. Assert the publication binds without
`delivery-authorized`, replay is byte-identical, and no second POST occurs. Revert only the live
PR-state check and require these cases to fail; retain an open current-head approval control.

### 2026-10-09 — cold navigation expired before its warmup allowance (introduced by PR #3222)

The E2E global warmup gave the launch overlay 180 seconds but left the preceding `page.goto('/')`
at Playwright's default 30 seconds. On a cold review server, navigation timed out before any selected
spec could start. The slow load's underlying cause was not established.

Blind spot: review checked the overlay wait's allowance without tracing every awaited operation that
must complete before it. Probe the real warmup entry with a controlled monotonic clock: a 35-second
navigation followed by a prompt overlay must pass under one 180-second deadline, while a hung
navigation or late overlay must fail within that same deadline. Assert explicit positive remaining
timeouts at both Playwright calls, identity validation before browser launch, and browser closure on
success and failure. A controlled unit probe alone does not prove hosted browser-spec admission.

### 2026-10-08 — a shutdown timing assertion measured more than its budget (introduced by PR #2976)

A native CI run for PR #5064 completed plugin reclamation but failed the test's `elapsed < 250 ms`
assertion at 252.790917 ms. The production budget charges only measured sleep during scheduler
polling; the test timed the whole synchronous shutdown cascade and a separate releasing thread.
The source of that run's extra wall time is unknown.

Blind spot: a wall-clock bound on a larger operation cannot distinguish a slow unrelated cascade
step or thread scheduling from a polling regression. Probe the private wait seam with a retained
runtime: require the first requested poll to be exactly 2 ms, release the runtime in that callback,
return a synthetic 252.790917 ms wait, and require reclamation with no second wait. Hold the runtime
through a synthetic 502 ms wait in a companion case and require one poll plus an abandoned report.
Mutating the request to the full budget, deferring the sweep until the end, or charging requested
instead of measured time must turn the respective case red.

### 2026-10-07 — a retryable Playwright install could hang forever (introduced by PR #4228; tracked by #5047)

PR #4228 added three attempts and backoff around `playwright install --with-deps`, but only a returned
failure advanced the loop. A stalled download never returned, so the E2E shard spent its full hour
installing and ran no tests.

Blind spot: the workflow contract proved retries existed but did not require an attempt deadline,
prove the overall install step fit below its job budget, or exercise a blocked child through the loop.

Probe that would have caught it: execute the workflow's extracted loop with a fake install process that
signals readiness, ignores TERM, and remains blocked; apply short TERM/KILL bounds and prove three
attempts reach the final nonzero exit. Separately pin each real attempt and the maximum aggregate
attempt-plus-backoff time below both the install-step and E2E-job budgets.

## Standing probes

- An aggregation test claiming a stored report route must use the production reader's filename and
  assert that both input records were admitted. An ignored artifact can make a boundary control pass
  while never reaching the claimed addition. For TypeSafe usage, prove stored scan plus verification
  and evaluation-reader outcomes independently: exact `MAX_SAFE_INTEGER + 0` succeeds and the next
  count refuses before record output. PR #4933 introduced the unchecked measurement addition; no
  historical reviewer stance or tier is established by this lesson.
- An SDK request test must execute in the server environment and capture the installed SDK's actual
  fetch body. A browser-environment refusal or a caller-only serialization assertion proves neither
  the exact wire string nor response-body timeout and cancellation. Preserve failed harness attempts
  separately from qualified behavior reproductions.

- For a queued MIDI expression test, cover both sides of the note lifetime: note-on before each member gesture, and every admitted gesture before note-off and the next same-channel note. Assert the recorded note fields through the byte dispatcher; a mocked handler call order that ends before release can pass while the curve is lost (PR #805).

- Apply the standard mechanical probe the Review section of `AGENTS.md` defines; this file does not
  restate it.
- A spec-only diff that turns red to green is the highest-risk diff class: for every hunk, read the
  product code the spec observes at head and decide stale-spec versus laundered defect.
- Exact-count and exact-shape assertions: verify the pinned value derives from the thing it claims
  to observe, not from whatever the code currently produces.
- A diff that adds an export to a contract barrel, or adds a barrel import to production code,
  changes what every spec mocking that barrel must supply. The sweep is mechanical and read-only:
  run `pnpm test:barrel-mocks` in the lane (guard-wrapped) and report every `✗` row it prints as
  the finding, named with the spec, the barrel, and the missing key.
- A test helper that names a production route in its doc — "one batch", "one drain", "the fenced
  path" — must emit the same fence, ordering, or envelope that production entry emits; trace the
  helper to the branch it actually drives, and a helper that reaches the loose branch while the spec
  claims the fenced one is the finding.
- When a spec pins a rule about repeated or overlapping events on one key, name the mutation that
  inverts the rule (last occurrence decides instead of first, a note-on covers instead of a note-off)
  and require the fixture to place the decisive event in the position that mutation would get wrong.
- A regression suite for a detector that asserts an invariant over a registered population must
  cover the invariant per adapter class, not replay the incident's fixture: enumerate the classes
  the population actually has — an ordering normalizer, an encoding change, a dropped field — and
  require a case in each that reverting the detector's invariant check fails. A suite green on the
  incident fixture alone does not discharge the detector's global claim.
- The e2e matrix never runs on a pull request, so nothing on the reviewing head catches a spec left
  asserting a control the diff renamed, removed, or replaced: sweep `tests/e2e/` for the old control
  name, aria-label, or text and re-home the affected specs in the same change. When a diff adds,
  removes, or reorders a desktop-bridge crossing on a launch or project-activation route, search
  `tests/e2e/` for the command string and for specs pinning an exact runtime-call list
  (`desktopRuntime.spec.ts`), and update the pinned list in the same change. A control can also be
  retired with no rename at all: when a diff changes a control's enabled, disabled, or visibility
  condition, read the changed control's attributes in the product and search `tests/e2e/` for each
  value it can be located by — its test id, its aria-label or accessible name, its placeholder, its
  title, and its rendered text — never for assertion names, which select unrelated specs. Those forms
  are examples of what to search, not a closed set, so also add any spec that reaches the control by
  role or text alone. Search every form the control has, not one of them: one term reaches only the
  specs that read that form and misses the specs that read another. The population the step acts on is
  the union of those searches, the specs whose locators resolve to the changed control; inside each
  returned spec, inspect every state read of that control: `toBeVisible`, `not.toBeVisible`,
  `toHaveCount`, `toBeDisabled`, `toBeEnabled`, `toBeHidden`, and the `isDisabled()`, `isEnabled()`,
  `isVisible()` conditional guards — the conditional-admission class the blind spot below names.
  Re-check each against the new condition and re-home it in the same change: a guard strands every
  assertion behind it, so a guard keyed on a state the diff changes must be re-homed even when no
  control was renamed, removed, or replaced.
  When a diff adds text-bearing UI beside an existing text locator, search `tests/e2e/`
  case-insensitively inside the text locators' own arguments — `getByText(...)`,
  `getByRole(..., { name: ... })`, `getByLabel(...)` — for the added sibling's own text, never
  whole-file text, which returns every spec that merely mentions it; that search finds the candidate
  arguments, but the judge runs the other way: a text locator becomes ambiguous when its argument is a
  case-insensitive substring of the added element's text, so an argument that contains the sibling's
  text, such as `getByText('Synth panel')`, would not match the option at all; keep only the candidates
  whose kind or role can select the added element, because a role-scoped locator for a different role
  cannot; the population is the specs holding such a locator, bounded because only a matching locator
  argument can resolve to the wrong element; for the recorded `synth` sibling that is the two specs
  holding `getByText('Synth')` — `tests/e2e/instrumentPanels.spec.ts` and
  `tests/e2e/templateAndInspectorFinal.spec.ts` — against the twelve a whole-file text search returns
  and the three a role-blind search returns, the role test removing `tests/e2e/e2eWorkflow.spec.ts`,
  whose `getByRole('button', { name: /^Bypass Synth/i })` at line 82 and
  `getByRole('button', { name: /^Enable Synth/i })` at line 86 are role-scoped locators for `button`
  that can never resolve to the added `<option>`. Require every spec in that population
  to redden if its locator is now ambiguous — `getByText` matches case-insensitive substrings, so a new
  sibling makes it a strict-mode violation or makes `.first()` select the wrong element.
- An either-arm assertion is a standing escape: select every hit of `expect\([^)]*\|\|` across the
  specs under review, with no qualifier about whether its arms can hold independently, and require
  each arm to be load-bearing by mutating that arm's condition away and confirming the assertion
  reddens — that mutation is how a dead arm is exposed, and until both arms are proven the
  disjunction can be silently narrowed to a single live arm.
- A test whose expectation is computed with the code's own expression cannot observe a divergence
  between that expression and its consumer's: it proves the expression is stable, never that it
  agrees with the boundary that will refuse the value. Pin the figure at the consumer's boundary, and
  state which source each literal came from.
- For every assertion a change adds, mutate the input it reads and confirm it fails _alone_, with
  its neighbours exactly as shipped. A pin placed after another assertion that already fixes the
  same value observes nothing; a relation with slack cannot redden the constant it was written for;
  a parse that reads the first match in a file bounds whichever entry comes first rather than the one
  it names; and a ratio derived from a value its neighbour pinned is arithmetic, not a check.

## Lessons from escapes

### 2026-10-10 — ZIP fixtures left paired writer timestamps to chance (introduced by PR #4057, commit `d608d165a49`)

PR #4057 added the streamed-artifact positive case and ZIP-based strict-parser fixtures without
explicit `mtime` values. In fflate 0.8.3, streamed `Zip.add` and `Zip.end` each call `wzh` for the
local and central header; `zipSync` calls that same writer twice for every file. Each call reads a
fresh `Date.now()`. If a pair crosses a DOS two-second timestamp boundary, the timestamp words
differ and the unchanged parser rejects the archive before the intended descriptor, bounds, or
decompressed-data oracle. The CI failure established parser rejection, not how often or how quickly
the reads crossed the boundary.

Blind spot: fixture validity depended on separate live clock reads, so the archive's metadata could
fail before its intended positive or negative assertion ran.

Probe that would have caught it: force actual streamed and `zipSync` writers across a DOS two-second
boundary, capture local and central timestamp bytes, and require the strict parser to reject the
archive. Apply one fixed fixture `mtime` through the supported `zipSync` options and streamed-entry
property; run the owning spec with its payload, bounds, CRC, file-set, encryption, and descriptor
oracles intact. On the fixed head, reverting `mtime` must make the forced-clock case red. Keep the
strict parser unchanged; this probe does not establish the hosted failure's clock interval or rate.

### 2026-10-09 — a newly declared "every spec owes the first-paint bound" left literal 15 s and 30 s waits in place (escaped via commit `04c28be0f8`)

Commit `04c28be0f8` declared in `tests/e2e/e2eUtils.ts` that every spec waiting on the launch overlay itself owes `LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS`, but did not sweep the specs that already waited with a literal bound; the 15 s in `promptBarCancelRecentTestId.spec.ts` came from commit `d78dac728a`. It surfaced only when two Playwright workers per runner added CPU contention and a cold boot was still on its loading overlay at 15 s.

Blind spot: a contract written as prose ("every X owes Y") binds sites the diff never touches, and a green suite on the declaring head cannot show them, because the literals were sufficient until contention changed boot time.

Probe that would have caught it: when a change declares an "every X owes Y" contract, grep every existing X, run a census of them against Y, and land the census as a spec that reads the real files and cannot pass by matching nothing.

### 2026-09-28 — one aggregate deadline hid cumulative closure work (CI run 36366521880, job 108754137864; introduced by PR #4775)

The trusted-write closure spec walked all 13 command graphs in one Vitest case. Each walk independently proved its command's exact closure, but the accumulated work took 5547 ms against the default 5000 ms case timeout and failed the CI shard. The failure was test granularity, not evidence that a command graph was wrong.

Blind spot: independent obligations shared one per-test deadline, so their cumulative cost could fail the aggregate case without identifying a slow command by its own named result.

Probe that would have caught it: when a spec repeats an independent invariant across a registered population, probe the cumulative work under the actual default deadline. Keep each population member as a named parameterized case with its own fresh inputs and deadline, preserve a mutation-discriminating assertion for every member, and do not raise the shared timeout to mask aggregate work.

### 2026-09-28 — an elapsed-time readiness test omitted the real progress producer

The existing timeout cases exercised stalled Crumbs loads and captured-generation isolation, but no check drove Levain's decoded-bank progress into all five live TrackNodes across the 10-second boundary. A green timeout test therefore could not distinguish a healthy cold bank from a stall. PR #3982's review explicitly scoped out progressing-load policy and caller-visible outcomes; the test gap is the missing #3318 acceptance probe, not a failed #3982 cohort oracle.

Probe: use the real decoded-bank producer and sink/descriptor route, assert each captured device receives its own increasing completion callback, then cross the old deadline, finish the finite bank, and require five token-matched worklet acknowledgements. Reverting progress forwarding or the per-device renewal must redden that case. Independently hold one final acknowledgement and one stalled peer, and assert typed failure rather than treating promise settlement or decoded bytes as playable readiness.

### 2026-09-28 — specs that measured a budget with the budget's own expression could not fail (escaped via PR #4491; merge `9effe3689c`)

The semantic review's planner and its provider each measured one request budget differently — the planner reserved a hand-rolled wrapper, the provider measured `{state, questions}` — and the specs asserted the planner's figure with the planner's arithmetic, so the nine-byte divergence that left 37 of 42 scanned units unassessed in CI — the oversized unit under its own `budget_exhausted` refusal and 36 more under `budget-exhausted-before-admission` — was invisible to a green suite. The class of pin that cannot fail reappears whenever a repair adds pins, and each shape is checkable in the spec at head rather than in the history: an assertion reachable only after a neighbouring pin has already fixed the same value, a relation with enough slack that the constant it was written for cannot redden it, a parse that reads the first match in a file rather than the entry it names, and a ratio computed from a value its neighbour pinned.

Blind spot: a suite that measures the system with the system's own arithmetic is self-consistent by construction, so it can never fail on the disagreement that matters; and a pin written beside an exact pin feels like coverage while observing nothing. The first real signal came from running the command end to end and reading its own report, not from any test.

Probe that would have caught it: for each budget, take the consumer's expression as the oracle and assert the producer's admitted unit against it (`JSON.stringify` byte length against the profile's ceiling). For each pin, mutate the input it reads with its neighbours untouched and require it to fail alone; when a mutation leaves the suite green, the pin is the finding.

### 2026-09-26 — a startup bridge crossing left the desktop-runtime call list stale (escaped via PR #4568)

PR #4568 (commit `a0aa4c1f18`) added `clearInheritedRetrospectiveCaptureArm()` to `src/app/main.tsx`,
issuing a `disarm_retrospective_capture` bridge call before anything renders whenever a desktop
bridge is present. `tests/e2e/desktopRuntime.spec.ts` pins the exact ordered list of non-poll
runtime calls a launch issues; it was never updated, so nightly e2e reddened on `main`.

Blind spot: e2e never runs on a pull request, so a new call on the startup path has no check on the
reviewing head, and a call-list pin looks like an assertion about diagnostics polling rather than
about every crossing the launch route makes.

Probe that would have caught it: when a diff adds, removes, or reorders a desktop-bridge crossing on
a launch or project-activation route, search `tests/e2e/` for the command string and for specs
pinning an exact runtime-call list, and update the pinned list in the same change.

### 2026-09-22 — renamed controls and an ambiguous text locator left `tests/e2e/` stale (escaped via PRs #4464, #4473, #4479)

The nightly end-to-end train reddened on `main` across six of twelve shards: the `Command Mode`,
`Confirm actions`/`Cancel actions` and `toBeDisabled` failures came from a spec asserting a control
or state the product no longer exposes, while the two Synth failures came from a newly added sibling
that made an existing text locator ambiguous. The composer's "Command Mode" button was
removed on 2026-08-15 by commit `bd618a5a79` ("fix(agent): expose governed execution modes"), which
replaced it with the `Agent execution mode` select; PR #4479 removed the prompt bar's inline
`Confirm actions` / `Cancel actions` controls; and PR #4464 removed the `isLlmAvailable` term from the
composer's `disabled` expression — retiring that state contract, leaving
`chatComposerTestId.spec.ts`'s `toBeDisabled()` assertion stale, and, because the stale `Command Mode`
locator sat behind an `isDisabled()` guard, unmasking that five-week-old locator. PR #4473 added a
track-role `<option value="synth">` above the inspector's `Synth` device card, so `getByText('Synth')`
matched both — a strict-mode violation in one spec and, because `getByText` matches case-insensitive
substrings, `.first()` resolving to the invisible `<option value="synth">`, whose click timed out at
line 63 and reddened that spec and its shard. A text locator that resolves to the wrong element
makes its assertion observe something other than the intended control, and when the assertion is a
disjunction written against that locator, an arm it cannot satisfy is dead: the disjunction
silently narrows to whichever single arm still holds.

Blind spot: e2e never runs on a pull request, so a control rename, removal, replacement, or state
change has no check on the reviewing head; a guard keyed on a state the diff changes hides the stale
locator behind it; a text locator is treated as stable when a new sibling's text is a
case-insensitive substring of it, so the locator resolves to the wrong element and the assertion
observes something other than the intended control; and an either-arm assertion whose arms can hold
independently is accepted as covering both when one arm may be dead.

Probe that would have caught it: when a diff renames, removes, or replaces a control, sweep
`tests/e2e/` for the old control name, aria-label, or text and re-home every stale spec in the same
change; when a diff changes a control's enabled, disabled, or visibility condition, read the changed
control's attributes in the product and search `tests/e2e/` for each value it can be located by —
its test id, its aria-label or accessible name, its placeholder, its title, and its rendered text —
never assertion names, and take the union of those searches rather than one term: one term reaches
only the specs that read that form and misses the specs that read another; those forms are examples
of what to search, not a closed set, so also add any spec that reaches the control by role or text
alone; the population is the union of those searches, the specs whose locators resolve to the changed
control; inside each returned spec, inspect every state read of it — `toBeVisible`,
`not.toBeVisible`, `toHaveCount`, `toBeDisabled`, `toBeEnabled`, `toBeHidden`, and the
`isDisabled()`, `isEnabled()`, `isVisible()` guards — and re-home each in the same change; when a
diff adds text-bearing UI beside an existing text locator, search `tests/e2e/` case-insensitively
inside the text locators' own arguments — `getByText(...)`, `getByRole(..., { name: ... })`,
`getByLabel(...)` — for the added sibling's own text, never whole-file text, which returns every
spec that merely mentions it; that search finds the candidate arguments, but the judge runs the
other way: a text locator becomes ambiguous when its argument is a case-insensitive substring of the
added element's text, so an argument that contains the sibling's text, such as
`getByText('Synth panel')`, would not match the option at all; keep only the candidates whose kind
or role can select the added element, because a role-scoped locator for a different role cannot; the
population is the specs holding such a locator, bounded because only a matching locator argument can
resolve to the wrong element; for the recorded `synth` sibling that is the two specs holding
`getByText('Synth')` — `tests/e2e/instrumentPanels.spec.ts` and
`tests/e2e/templateAndInspectorFinal.spec.ts` — against the twelve a whole-file text search returns
and the three a role-blind search returns, the role test removing `tests/e2e/e2eWorkflow.spec.ts`,
whose `getByRole('button', { name: /^Bypass Synth/i })` at line 82 and
`getByRole('button', { name: /^Enable Synth/i })` at line 86 are role-scoped locators for `button`
that can never resolve to the added `<option>`; require every spec in that population to
redden if the locator is made ambiguous —
`getByText` matches case-insensitive substrings, so a new sibling makes it a strict-mode violation or
makes `.first()` select the wrong element — then assert the control through stable handles (test ids,
roles) rather than bare text; and select every hit of `expect\([^)]*\|\|` across the specs under
review, requiring each arm to be load-bearing by mutating that arm's condition away and confirming
the assertion reddens before the disjunction counts.

### 2026-09-21 — internal level assertions missed the provider wire (escaped via PR #4392)

PR #4392 (`5c476c92153`) added linear/decibel project-context fields, but its provider assertion covered only master and track decibels in one projection. It did not inspect the final full and delta messages for paired master, track, send, clip, and gain-lane values.

Coverage gap: the added assertions proved producer objects and a master/track-only provider projection, but did not inspect the correction-round delta or nested level fields.

Probe that would have caught it: inspect `buildAgentContext().message` in full and delta modes, mutate an unselected track's clip, send, and gain lane independently of its gain/name, and require every linear value beside its decibel reading, removals represented, and exactly one law header.

### 2026-09-21 — an expected refusal printed as a failure misled two readers (issue #4486)

The publish spec inherited the trusted publisher's stderr, so a refusal the case deliberately provokes
(`expected exactly one locked author lane`) printed to the shard log and read as a test failure to two
readers across two review rounds. Probe: capture child stderr in the helper and assert refusals through
the thrown error, then require a deliberately-refused case to leave the spec's own stderr clean.

### 2026-09-19 — an Anthropic usage fixture mirrored the raw-field mapping (escaped via PR #4393)

PR #4393 normalized Anthropic `input_tokens` directly as total input while also exposing cache-read and
cache-creation counters. Its fixture reported 50 raw, 5 read, and 8 creation tokens, then asserted 50,
so the test encoded the faulty mapping instead of the provider's documented 63-token billing total.

Blind spot: the adapter test checked that every wire field reached some result field, but never stated
which counters are subsets and which normalized counter is inclusive. The later attribution helper
repeated the production mapping, so it could not expose a dropped field in that mapping.

Probe that would have caught it: use unequal raw, cache-read, and cache-write values; assert their
inclusive total and separate counters through the real provider producer, protocol accumulator, run
budget, and cost projection. Make the terminal stream event output-only, and require the initial input
and cache counters to survive without being added twice.

### 2026-09-18 — a command whose own spec imported it, and a freshness check that healed the state it asserted (escaped via PR #4356)

`scripts/restampWasmInventory.ts` ended in a bare `run();` with no entry guard, and its spec imported the module for its helpers, so collecting the spec executed the command: running it rewrote `release/open-source-inventory.json`, the spec's "the command reports a current inventory on a fresh committed tree" case then observed the file it had just healed and could never fail on a drifted tree, and on a tree the command would refuse the module-level throw prevented the file's tests from running at all. The same head's refusal also told the reader to run "its wasm:* script", a name that does not exist for every package.

Blind spot: the stance asked what each assertion would do under a mutation of the logic under test, but treated one spawned end-to-end case as covering the command without checking which branch it took — that tree had nothing to restamp, so every write-path mutation stayed green — and it never asked what the spec's own imports do to the tree.

Probe that would have caught it: for a spec that imports the module it tests, import it against a deliberately drifted fixture and require every tracked file to be unchanged; then require the command's happy path to be exercised on a drifted fixture and delete the write, retarget the path, drop the refusal call and remove the printing, requiring each mutation to fail the suite.

### 2026-10-09 — a landed recovery receipt left a modern dossier unbound (issue #5111)

An absent-lock replay returned success from its receipt before authenticating or inspecting the
landed review. The fresh-owner recovery test exercised a different branch, so it did not prove
historical receipt adoption or native publication replay.

Probe that would have caught it: start with an exact landed version-2 receipt, no lock, and a modern
unbound dossier; require two stable exact remote reads, one append-only publication binding, and a
second recovery plus native publish replay with no new POST. Restore the old early return and require
the owning assertion to fail. On a merged PR, require publication binding without retrospective
delivery authorization; on an open current approval, require zero unresolved threads for authority.

### 2026-09-02 — a rejected review stranded its mutation lock (escaped via PR #3342)

Review publication treated a definitive GitHub validation rejection as an ordinary failed write and retained a generic lock owner with no immutable publication intent. A later operator could not prove whether the review landed, so neither release nor replay was safe.

Blind spot: tests asserted request validation but not the lock's recovery evidence after a remote mutation boundary.

Probe that would have caught it: force a definitive 422 after the journaled pre-write transition, then prove recovery releases only when the prepared bundle digest, head, reviewer actor, and remote review enumeration all match; mutate each field and require the exact owner to remain retained.

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
request's gate stayed green — the unit legs were softened on pull requests at the time — no stance
raised it, and the author found it by running the spec.

Blind spot: the stance read the diff's own specs and the specs of the files the diff edited. A
`vi.mock` factory in an unedited file is a contract with a barrel, and a diff that widens what
production code takes from that barrel breaks that contract without appearing in the diff at all —
nothing in the changed lines points at the spec that now fails.

Probe that would have caught it: when a diff adds an export to a barrel, or adds a barrel import to
production code, grep the repository for specs mocking that barrel; for each, decide whether its
factory spreads the original or lists keys, and whether the spec transitively executes the changed
production path. A listing factory on an executed path is the finding, named with the missing key
and the spec that will fail. The unit legs block a pull request now, so this failure class does
reach the gate — but only on a head the suite has actually run against, and only for the shard that
holds the spec. Read the gate as evidence about the head it ran on, never as evidence about a spec
no run in this pull request executed.

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
program inside the review worktree defined in the Reviewer isolation section (extend the lane
tsconfig with strict options, include the changed files plus the ambient types the import closure
needs) and require exit 0; reproduce the failure pre-fix when validating a posted type finding. (PR
#3136's dispatch already carried this probe and produced clean heads.)

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

### 2026-09-09 — one native trace nesting edge never reached equality (escaped via PR #4068)

The helper fixture always ended the AudioWorkletNode handler after its outer callback. Its separate
equal-endpoint case exercised only the author/outer relationship, so reverting the handler/outer
equality rule still left every test green.

Probe that would have caught it: for every nesting comparison the parser validates independently,
add one case with equal end timestamps and one with the enclosure ending a single timestamp unit
early. The first must admit only a unique enclosure; the second and the existing overlap fixtures
must refuse.

### 2026-09-09 — transaction tests skipped the committing window (escaped via PR #806)

The captured-scope test entered only after settlement. It never exercised the separately supplied scope while commit
was publishing, nor a scope entered before commit whose callback continued with a later write, so one guard could mask
the absence of the other.

Probe that would have caught it: publish document A through the real atomic port shape and synchronously re-enter each
scope from its listener. Assert callback entry count is zero separately from cache, document, and pending-write state.
Then enter a scope before commit or abort and attempt `set` and `clear` afterward; reverting only the write-context guard
must fail that case while reverting only a scope-entry guard must fail its callback-entry assertion.

### 2026-09-03 — a native method read off its host and called unbound (escaped via PR #2097)

`electron/scanWorker.ts`'s `nativeCommand` read a napi class method off the addon host and returned
the bare function; `main` then invoked it unbound, so every packaged scan failed with `Illegal
invocation`. The same PR added the identical read in `router.ts` and bound it correctly through
`Reflect.apply(implementation, host, callArguments)` a few files away — one surface handled two ways
in one diff, and nothing raised the divergence.

Blind spot: the spec's fake host used an arrow function for `scanPlugins`, which ignores `this`
entirely, so a bare reference and a properly bound call produced the same passing assertion; the
fake could not distinguish the defect from the fix.

Probe that would have caught it: when a diff reads a method off a native or class host and calls it
later, fake that host receiver-sensitively — a plain function or class method that throws unless
`this` is the host — so an unbound call fails the spec; then diff every call site reading the same
kind of host for consistent receiver handling, and flag one that binds where another does not.

### 2026-09-03 — a missing-environment assertion that read the runner's ambient variables (escaped via PR #3513)

The spec expected the `GITHUB_REPOSITORY` refusal while stubbing neither GitHub variable. Actions
exports `GITHUB_REPOSITORY` to every step, so the runner threw for `GITHUB_TOKEN` instead and the
case failed on every nightly shard while passing on the author's shell. PR #3526 repaired it by
stubbing `GITHUB_REPOSITORY` to `''` before the first assertion and re-stubbing `GITHUB_TOKEN` to
`''` before the second.

Blind spot: a spec that asserts on the absence of an environment variable is only valid if it
controls every variable the code reads, and the stance checked what the spec stubbed rather than
what the runner already exports.

Probe that would have caught it: for any assertion on a missing-environment error, list every
`process.env` name the code path reads before the asserted one and require the spec to stub each of
them explicitly; run the spec once with `GITHUB_REPOSITORY`, `GITHUB_ACTIONS`, `CI`, and
`GITHUB_TOKEN` exported in the shell.

### 2026-09-04 — a workflow comment's claim about a third-party installer read as evidence (escaped via PR #3548)

PR #3548 added the nightly `desktop-measure` leg. Its install step said "BlackHole is a HAL
plugin: coreaudiod picks it up as soon as the cask lands it, so nothing here reboots." The cask's
own caveat prints "You must reboot for the installation of blackhole-2ch to take effect", its pkg
distribution declares `onConclusion='RequireRestart'` with a post-install script that only fixes
permissions, and coreaudiod enumerates `/Library/Audio/Plug-Ins/HAL` only when it starts. The first
hosted run failed at `SwitchAudioSource` with
`Could not find an audio device named "BlackHole 2ch"`. The approval attacked "whether every step's
precondition holds in order on a hosted macos-latest runner" and reported all held, having checked
the claim against the comment rather than the package; actions/runner-images issue 11746 had
recorded the same failure and the `sudo killall coreaudiod` fix since March 2025.

Blind spot: a comment or pull-request body asserting how a third-party installer, runner image, or
external service behaves was accepted as evidence, and a job that cannot run on the pull request
was approved with no run of it at all.

Probe that would have caught it: for every claim about an external component in a workflow diff,
open that component's primary source — the cask or formula, the installer's distribution and
post-install scripts, the runner-image release notes, the vendor's open issues — and quote the line
that supports or contradicts the claim; a caveat, restart flag, or open issue that contradicts the
comment is the finding. When the job cannot run on the pull request, name the first hosted run as
the only evidence and require the pull request's test section to say so.

### 2026-09-06 — a barrel consumer broke 28 mock factories (escaped two stances, #3910)

The head added two `#/modules/AudioEngine/useCases` imports to a MIDI dependency object. Twenty-eight
specs across ten modules mock that barrel with listing factories; the pipeline's Barrel mock
coverage step failed on the head after two test-validity rounds had cleared it, one of which had
this file's 2026-08-29 lesson in its dispatch.

Blind spot: the 2026-08-29 probe was phrased as a manual grep-and-judge sweep, so a stance under
time pressure judged the specs in the diff and the modules the diff touched, never the mocks in
modules the diff never named. Nothing in the changed lines points at them.

Probe that would have caught it: the checker exists and is cheap, so the probe is to run it, not to
reproduce it by hand — `pnpm test:barrel-mocks` on the head, every `✗` row reported. The author's
dispatch carries the same command whenever the change adds a barrel export or a barrel import.

### 2026-09-09 — storage tests observed one terminal but not reentrant execution (escaped via PR #576)

The adapter tests exercised an ordinary pending write and its final cache value. They never invoked a synchronous
publication listener that called the public flush again, never changed a later selected write during an earlier
preparation callback, and never compared terminal cache against a fresh decode of the actual published document.

Probe that would have caught it: use an atomic publish-then-notify port and assert mutation owner/count, raw document,
adapter cache, fresh decoder, pending count, and later flush. Delete the whole-snapshot claims, restore terminal pending
copying, capture a later write only when its preparation starts, remove callback identity checks, and remove the
post-publication error catch one at a time; each owning case must fail on behavior rather than error wording.

The same probe must publish newer same-slot authority from inside each independently guarded terminal/hydrate callback
and cover both later- and earlier-authored nested scopes. Bypass the authority-epoch check and the ambiguous terminal
call separately; each must leave raw and cache divergent and fail. Include projectors that return `null` and throw with
no configured initial value so nullish fallback cannot silently reinstate rejected document content.

### 2026-09-10 — catalog cases asserted presence, never selectability (escaped via PR #4128)

The catalog spec checked that the creation slots for a track target existed by object type and the
admission spec selected targets and dimensions, but no case selected a clip, notes, or device slot by
its published id and observed the minted authority carrying it. A duplicate-id defect that made
three slots unselectable therefore left every case green.

Mechanical probe: for each published id family (targets, dimensions, constraints, creation slots),
one case must select the LAST published member by id through the real admission and assert it on
the result; then mutate the id minting to collide and confirm that case goes red.

### 2026-09-10 — no fixture ever tied an interval START to the outer callback (introduced in 4266e649b, repeated at 0a4efc74f)

4266e649b's fixtures placed every handler and author start strictly inside or before the
outer callback; 0a4efc74f added the handler/outer equal-END fixture and repeated the
pattern, so both strict START comparisons were never exercised at equality. The first
nightly trace refused 2256 of 24001 callbacks tied on handler start.

Blind spot: the 2026-09-09 probe was phrased for one boundary only, and fixtures followed it
literally without covering both boundaries (start and end) of the nesting pairs.

Probe that would have caught it: for every nesting comparison independently validated, add one
case with equal start timestamps and one with equal end timestamps; for each pair, add a third
with the enclosure a single unit narrower. The equality cases must admit only unique enclosures;
the narrower and existing overlap fixtures must refuse.

### 2026-09-12 — groove identity guards compared object serialization (escaped via PR #471)

PR #471 introduced the extraction and inverse guards in `10bbf0bdcc` and the creation identity
guard in `c166247ea4`. They compared `JSON.stringify` output, so a fresh Automerge projection with
the same template or assignment fields in a different object-key order was rejected as changed.

Blind spot: the fixtures reused author-constructed objects and never crossed a fresh document
projection, while their retry assertions used the same insertion order as the producer.

Probe that would have caught it: cross a fresh document projection for creation idempotence and
guarded inverse checks, construct equal typed values with different top-level and nested key order,
and assert their JSON strings differ. Unchanged values must admit the no-write or inverse path,
while changed timing, dynamics, identity, and array order must still refuse.

### 2026-09-12 — MIDI split fixtures equated absent keys with undefined (escaped via PRs #638 and #1874)

PR #638 rebuilt split-right notes with absent optional fields materialized as own keys whose values
were `undefined`; PR #1874 repeated the shape while adding two expression fields. Automerge's JSON
boundary removed those keys, so the prepared undo guard could never match committed project truth.

Blind spot: the producer specs used `toEqual` with explicit `undefined` properties, an oracle that
also passes when those properties are absent.

Probe that would have caught it: compare generated optional-field objects with `toStrictEqual` or
explicit `Object.hasOwn` assertions before a serialized undo round trip. Require absent optionals to
stay absent, defined zero values to survive, and changed values and array order to remain distinct.

### 2026-09-12 — Replacement clones materialized absent clip fields (escaped via PR #2169)

PR #2169 introduced the shared replacement-clip clone with unconditional `overrides` and
`kneadState` properties. Inserting a captured clip that omitted those optionals therefore produced
own keys set to `undefined`; the strict glue freshness guard then rejected the live replacement even
though its serialized values were unchanged.

Probe that would have caught it: clone snapshots with each optional absent, explicitly present as
`undefined`, and populated. Use `toStrictEqual` plus `Object.hasOwn` to verify exact property presence,
mutate every populated nested container to prove source isolation, then run the connected glue
apply/undo/redo path and retain a changed-value conflict case.

### 2026-09-16 — a merge-conflict fixture left the winning actor to chance (escaped via PR #4292)

The repair-route integration spec cloned the remote side with actor `'b'.repeat(64)` against a local document holding a random `init()` actor, and asserted the remote value won. Automerge picks the concurrent value by greatest opId, actor deciding at equal counters, so about one run in four kept the local value and the spec failed on main with `expected 0.6 to be 0.7` on unrelated heads.

Blind spot: the fixture's chosen actor looked deterministic, and the stance never asked what the other side's actor was or which side the assertion assumed would win.

Probe that would have caught it: for any fixture that merges two concurrent writes to one key and asserts the surviving value, name both actors; if either is random, require the fixture to fix the ordering (an actor that sorts above or below every possible peer) and run the spec with the chosen actor flipped to the opposite extreme, expecting it to redden.

### 2026-09-17 — an arm click waited for a track a fresh project never has (escaped via commit 32179299b)

Two Playwright specs added `await page.locator('[data-testid^="track-arm-"]').first().click()` right after `launch_new_project(page)`. A new project starts with zero tracks, so the locator never resolved and both tests hit the 90 s suite timeout on every nightly run. E2E never runs on pull requests, only on approving-review runs and the nightly train, so Gate never executed the edited specs.

Blind spot: an E2E spec edit was accepted on a Gate that never runs E2E; the added step's precondition (a track exists) was never traced to the fixture (`launch_new_project` yields an empty arrangement).

Probe that would have caught it: for every edited or added Playwright step, name the fixture state the locator needs and trace it to the helper that produces it; run the edited spec locally with `pnpm test:e2e <spec>` because Gate will not; a locator whose precondition no helper in the test produces is the finding.

### Parameter replay-operation escape — unregistered alternatives hide owner-validation gaps

Session hydration introduced in `4f410257b212bbbd2210fa6553f7aaa3394f69bc` (no associated PR)
accepted unrelated replay types. PR #3328's per-action schema checks and PR #4108's policy-agreement
validator preserved that gap. The #4108 test-validity review mutated policy propagation and agreement,
but never substituted a valid different operation with the same absent policy.

Register both the intended and substituted operation contracts in the real hydration fixture, then
replace inverse and redo independently. An unregistered alternative fails generic admission before
the owner sees it and cannot prove owner validation. Include absent optional metadata, canonical
same-operation entries, and legacy same-operation entries. Revert only the owner's operation-type
check: the unrelated-operation cases must fail because history is admitted, while the positive
controls remain accepted.

### 2026-09-20 — incomplete hosted usage released the admitted estimate (escaped via PR #2648)

PR #2648 converted null input or output counters to zero and finalized the budget attempt, so a partial provider report
could lower the charged ceiling and appear as a complete provider total in route and approval views.

Probe that would have caught it: reserve a real hosted attempt, report each required counter as null independently, and
inspect the lifecycle budget plus the real route and approval projections. The reservation must remain non-final until both
required counters are known; then repeat the complete report and follow it with a partial one. The charge must settle once,
and both rendered cost surfaces must distinguish the pending reservation from a final provider-reported total.

### 2026-09-20 — compatible choice-count rejection lost billed usage (introduced by PR #4407)

PR #4407 kept an OpenAI-compatible response with zero or multiple choices as a typed, retryable protocol failure, but its fixture stopped at adapter rejection and never proved the already-read usage reached run billing.

Blind spot: the protocol-shape stance had no real adapter-to-inference-to-run/cost fixture, so it could preserve rejection identity while dropping the paid result.

Probe that would have caught it: stub a compatible 200 response with two choices and inclusive usage 63/9, drive the real adapter through inference and run accounting, and require one 72-token cost with the original attempt correlation, provider, and model, a typed retryable failure, and zero executable tool calls.

### 2026-09-20 — mocked cancellation hid failed durable revocation (escaped via PR #1949)

PR #1949 (`ce2ffea3fd`) added run-controller cancellation before pending-confirmation settlement,
but its owner spec mocked that controller. The mock could not expose live terminal state advancing
before `Storage.setItem` failed. Use the real lifecycle and cancellation controller, fail the actual
storage write once, then cancel the same confirmation again. Removing the persistence retry must
leave the saved run nonterminal and fail the assertion, both with and without cleanup assets.

### 2026-09-25 — a two-part artifact reader outlived the producer's move to an attempt-scoped name (escaped via PR #4577, introduced the gap PR #4582 widened)

PR #4577 added `scripts/semanticReviewContext.ts`'s `artifactIdentity`, parsing
`semantic-review-<pr>-<runId>` with a hand-written two-part fixture. PR #4582 moved the workflow's
`Upload the advisory report` step to the attempt-scoped `semantic-review-<pr>-<runId>-<attempt>`
(`.github/workflows/semantic-review.yml`) and pinned that three-part template in
`semanticReviewWorkflowContract.ts`, but never touched the reader. Every delivered assessment's
artifact then failed the reader's two-part regex, so `selectAssessmentArtifact` found nothing and
`resolveSemanticReviewContext` recorded `no-assessment` / `absent` for a check that was green: run
36217869489 carried artifact `semantic-review-4793-36217869489-1`, and `review:prepare 4793` wrote
`absent`.

Blind spot: the reader's own spec fixtures were hand-written to the reader's regex rather than
derived from the producer's upload-name template, so a producer-side rename could not turn the
reader's suite red; the producer and consumer of a CI-generated name lived in unrelated diffs, and
no case tied either side to the other.

Probe that would have caught it: for a consumer of a CI-produced artifact, check, or payload name,
derive the spec's fixture from the producer's own definition — here, `SEMANTIC_REVIEW_UPLOAD_ARTIFACT_NAME`
in `scripts/semanticReviewWorkflowContract.ts`, itself pinned against the live workflow YAML by
`healthGatesWorkflow.spec.ts` — with concrete values substituted for its template placeholders, and
assert the reader selects an artifact under that derived name; then mutate the producer's shape (add
or drop a segment, as the attempt scoping did) and require the derived case to fail rather than the
hand-written fixture staying silently valid.

### 2026-09-21 — unlinked command fixtures missed inaudible follower writes (escaped via PRs #931 and #4392; fixed in #4506)

PR #931 tested point delegation with a mocked unlinked writer, and PR #4392 tested decibel forms only on unlinked lanes.
For a point-command change, dispatch through real Command and CRDT-backed Automation state, then inspect the raw
document, owning projection, undo history, and `getAutomationValueAtBeat`. A handler-call or stored-value assertion
cannot prove the sampler will use the point.

## Lesson from the PR #645 projection-identity oracle escape

PR #645's selected-range Undo fixture treated a value-equal shallow copy as a stale conflict while successful fixtures
kept the original projection reference. That oracle accepted a guard which rejected ordinary CRDT settlement. Retained
evidence of a real post-settlement Undo probe is missing; historical stance dispatch is unverified.

Flush the production CRDT write and prove equal canonical values with replaced projection identity before actual Command
Undo. Assert raw/projected state, resolved comp coverage, buffer-retention metadata and history through Undo/Redo. Use a
changed clip value as the rejection control; a copied object alone is not conflicting project truth. Replacing fresh
semantic preparation with the retained handle must fail the settled replay case, while weakening intra-publication
guards must fail reentrancy or compensation controls. Include an initially empty lane with later peer fragment facets,
and a write-then-throw after their retirement, so empty captures and rollback cannot disappear behind helper-only proof.

### 2026-09-28 — disposable Git fixtures inherited asynchronous Trace2 writes (escaped via PR #4854)

PR #4854 added disposable Git fixtures whose child commands inherited `GIT_TRACE2_EVENT`; its event writer could
outlive a Git command and race `rmSync` with `ENOTEMPTY`.

Blind spot: the fixture checked Git's validation result but never checked whether an external writer remained active
while the temporary tree was removed.

Probe that would have caught it: run a real Git child under a supplied inherited Trace2 target and prove the fixture
disables tracing for that child (or that the target receives no child events); keep environment restoration in a
`finally` that runs even when recursive cleanup throws. A parent-process environment assertion or a mocked Git child
does not prove the external writer is isolated.

### 2026-09-29 — passing status-bar cases hid a Faust compiler abort (introduced by PR #4904; fixed in #4916)

The EDM status-bar E2E cases asserted rate and latency text but did not observe the console assertion emitted while the effect-free Supersaw loaded. The FaustWasm upgrade review's baseline probes covered node instantiation and passing tests, so they could not distinguish clean compilation from a caught, noisy failure followed by a successful fallback.

Probe that would have caught it: attach to the browser before template loading, capture the full console and exception stack, and require no compiler abort while the real Supersaw and reverb nodes load. Pair that check with the real compiler's factory inputs and an offline `keyOn` PCM assertion; status text alone proves neither clean compilation nor audible output.

When a repair adds a `compile`-named production route, run the device-write boundary closure census and account for each new match by its actual runtime or document effect. A narrow audio spec does not prove the production sink inventory still closes.

### 2026-09-30 — exact payload assertions preserved uncompensable MIDI transforms (escaped at 64b9d77c01a)

PR #939 (`90953dc23e0`) asserted the shared transform helper's complete inverse and redo payloads and
exercised handlers through direct execution before a replay guard contract existed. The checks were
not extended when commit `64b9d77c01a` added guarded compensation preflight or when PR #2747
(`06fb56e3897`) restricted restore replay to guarded actions. They therefore preserved snapshot shape
and ordinary undo while never entering the atomic admission that now rejected the family. No
pull-request number is recorded in Git history for `64b9d77c01a`.

Parameterize every handler registered by the shared transform map through the real atomic executor,
with one undo entry and concrete full-note poststate, undo, and redo oracles. Include deterministic
seed control for humanize. Delete `noteTransformReplayGuard` from the inverse and redo to prove the
case turns red. Separate cases must show invalid initial topology rejects both atomic and direct
execution without notes or history changing, and that stale topology or notes leaves committed undo
pending. A helper-level payload assertion alone is not caller admission proof.

Make the direct-dispatch topology oracle individually load-bearing for every registered transform:
cross each transform with missing, wrong-kind, frozen, locked, and duplicate-ID targets through the
real dispatcher, and assert notes plus both history stacks stay unchanged. One representative action
cannot carry the family-wide claim. For replay, duplicate the clip ID on the same track and on another
track after commit for undo, then again after undo for redo; assert the live notes remain exact and the
blocked history entry stays on its original stack.

## Escape: opaque Bearer fixtures missed complete caller admission

[PR #4491](https://github.com/jcosta33/sourdaw/pull/4491) introduced the screen and
adapter in `9effe3689c72384f30f60971ca40f26a44c0a355`. Issue #5144 exposed a
value-bearing HTTP scheme outside vendor prefixes and secret assignments. Synthetic offline
SDK/CLI captures established admission into request bytes, not real credential disclosure; the
historical stance name, prompt and tier are unestablished.

Compose opaque fixtures at runtime and exercise actual scan, verify, complete request and stance
callers. Assert refusal unconditionally together with zero cache read/write, budget reservation,
recording/provider invocation and delegated fetch; an empty answer or caught provider error is
insufficient. Use a schema-valid would-hit cache, a later unsafe candidate after an admitted
placeholder, repeated calls, ordinary controls and clean independent units. Preserve the separate
serialized-only fixture. On a committed head, removing the recognizer must redden the caller cases,
and bypassing preparation before cache must redden the would-hit-cache cases.

PR #5156's unlanded comment/array repair extended a source fixture to raw line comments,
but its scan hunk still ended at line one. The paired value was on a later line, so the
fixture screened a different input and could not establish the intended withholding.
Derive the fixture's admitted range from the complete multiline binding; preserve an
independent beyond-hunk fallback case. Require the final unchanged fixture to fail when
only the committed recognizer is reverted. A full-source screen assertion does not prove
which region the real scan caller admitted.

### 2026-10-10 — exact Rust cache fixture omitted rust-std (escaped via PR #5269)

PR #5269's successful exact-hit fixture reported rustc, cargo, rustfmt, and clippy, so it
could not expose that the cache admission omitted the host `rust-std` required by rustup's
minimal profile.

Probe that would have caught it: keep `rust-std-<host>` in the complete exact-hit fixture,
then remove only that component while leaving rustc, cargo, and every TOML extra installed.
Require the exact cache hit to fail before any toolchain-install request; the preserved full
fixture must still pass without installation.

The component registry alone is insufficient: a partial restore can retain its
`rust-std-<host>` entry while losing the host library payload. Keep the registry
entry in the broken fixture, make a one-input `std`-using metadata compile fail,
and require setup to fail before Cargo admission with no install or success output.
The complete exact-hit fixture must pass the same compile without installation.
