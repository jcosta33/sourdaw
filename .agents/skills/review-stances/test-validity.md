# Lesson library: test and evidence validity

A test, check or piece of evidence is invalid when it passes without observing its subject: its entry
point is never admitted, its oracle is computed by the code under test, a double stands in for the
boundary that would fail, its fixture never holds the deciding input, or its verdict depends on
timing, ambient state or work the case does not own. Each probe answers the baseline question from
the Review section of root `AGENTS.md` (what must break for this check to fail, and does it observe
what its name claims?) and carries its baseline mechanical probe unrestated: revert the behavioral
hunk or apply one targeted mutation, run the named spec, and a remaining green fails the round. Run
mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation). Report
a probe that cannot run with its exact mutation, named check and limitation, never as passed.

To record an escape, cite its pull request on the probe whose wording would have caught it. Add a
probe only for a failure mode none of these names; retire one only when a named check enforces it.

## Standing probes

1. **Conditional admission: the case can finish without reaching its subject.**
   A body inside `if (await locator.isVisible().catch(() => false))`, an optional locator, an early
   successful return, input sent to an element the consumer does not listen on, a parameter name the
   engine ignores, or a fixture on another branch can end green with no assertion. Probe: make the
   required entry point unavailable (rename its locator, unmount it, misname the parameter) and
   require the case to fail. Before any negative, assert the subject was admitted: the route selected,
   every input record consumed by the production reader, the valid control accepted, the write run.
   (#4441, #1531, #1536, #1590, #5370, #2606, #4356, #4933, #5111, #4987, #5144)

2. **A negative case passes on the wrong refusal.**
   Probe: require the unmodified subject to pass a positive control on the same fixture, and require
   the refusal to name the injected cause (path, field, error class, reason). Disable only the guard
   under test while leaving any unrelated failure in place; the named case must fail. An earlier
   intake or schema refusal, generic rejection of an unregistered alternative, a setup lock, a changed
   fixture digest, a broad failure regex or an unrelated census mismatch must not satisfy it. Feed
   each guard its own violating row with every other precondition met, audit every new lexical match
   before updating a census count, and assert deliberate refusals through the thrown error with the
   spec's stderr clean.
   (#2927, #5852, #5829, #1650, #2712, #3328, #4108, #5646, #4128, #5291, #4486)

3. **The test drives a helper while the production caller takes another route.**
   Probe: drive every real entry route (component, registered Command handler, bridge, dispatcher,
   planner, file admission, worklet schema, a selected as well as an explicitly opened target) through
   to the consumer that reads the value (sampler, ruler painter, metronome, billing, clip placement).
   Revert only the caller's use of the behavior (its dispatch, forwarding, or final consumer of a
   flag); the caller-level case must fail. A reader verdict, sanitizer, parser, handler `isNoop` or
   payload pinned in its own spec proves no admission. A helper that claims a production route ("one
   batch", "the fenced path") must emit that route's fence. After a failed or refused step, drive the
   next effectful call and require that no staged authority or partial result is used.
   (#3905, #4929, #2648, #1049, #5277, #5339, #2083, #5643, #939, #5254, #4392, #4407, #5247, #5215)

4. **A test double cannot fail the way the real boundary does.**
   Probe: type each mock from the exported callable and return its complete current result, so a
   stale owner result cannot pose as tested recovery. Fake a host receiver-sensitively, so an unbound
   method call throws. Derive fixtures from the producer's definition (live schema, upload-name
   template, the query the adapter emits), never from the consumer's regex or a hand-written response.
   Replace call spies and mocked authority with the real owner, and keep real state apart from any
   read projection that could hide it. Mutate what the double hid (drop `this`, change the result
   shape, add a segment, write outside the barrel, omit a still-present remote record from reads) and
   require the case to fail. Read logged errors even when every assertion passes.
   (#2097, #4496, #1949, #5705, #4577, #5649, #474, #2597, #4271, #2811, #5639, #2035)

5. **The oracle is computed by the code under test.**
   Probe: take each expected value from an independent source and write it as a literal stating its
   source: the consumer's boundary (`JSON.stringify` byte length against the provider ceiling), the
   documented contract (an inclusive billing total), independent arithmetic (seconds from a tempo
   ramp's integral), or real public commands run from the same prestate. Two chunkings through one
   copy path, a helper repeating the production mapping, an expectation derived from the helper's own
   constant, and an untraced anchor prescribed by the orchestrator are self-consistent and cannot
   redden. Mutating the shared expression must fail the case. An exact count or shape must derive from
   the thing observed, not from what the code currently produces.
   (#4491, #4393, #5239, #5437, #5723, #5243, #5323, #5495, #5578)

6. **A pin cannot fail on its own.**
   Probe: mutate the input each added assertion reads, neighbours as shipped, and require it to fail
   alone; run it alone and after its preceding cases, since cached registration can mask a guard.
   Shapes that observe nothing: a pin after one already fixing the value, a relation with slack, a
   first-match parse, a ratio from a pinned neighbour, `toHaveBeenCalledWith` where a second reply was
   lost (count calls), whole-note RMS hiding a dip, and an absence check masking the guard mutation.
   Select every `expect\([^)]*\|\|` hit and mutate each arm away; each arm must redden.
   (#4491, #4473, #5091, #5227)

7. **Equality in the oracle differs from equality at the boundary.**
   Probe: compare with the boundary's semantics. For optional fields use `toStrictEqual` or
   `Object.hasOwn`: absent stays absent, explicit `undefined` is distinct, a defined zero survives.
   Cross a fresh projection with reordered keys and a replaced projection object holding equal values:
   equal values must be admitted, changed values or array order refused. Keep CRDT scalar types JSON
   would erase. Swapping in the looser or stricter comparison must fail the case.
   (#638, #1874, #2169, #471, #645, #5649)

8. **The fixture never holds the deciding input.**
   Probe: name the mutation that would get the rule wrong, place the deciding input where it errs, and
   require the unchanged case to fail when the fix is reverted. Escaped inputs: equal start and end
   timestamps plus a one-unit-narrower enclosure for every nesting comparison; first versus last event
   on one key; gestures on both sides of note-on and note-off; distinct values inside one tolerance; a
   full tempo excursion; a fractional change whose next tick is outside the window; an off-grid loop
   seam; layer and width cross-products; one frame past a cap; the highest rate the constructor admits;
   a fresh instance with no parameter write; the cold state before first Play; the last published id
   per family; budgets of zero and one over mixed holders; two omissions before completion; failure
   sequences whose reason must stay stable; a locked automatic row; input that changes the detected
   population; paths containing diagnostic words; exact classifier paths beside suffix lookalikes;
   each required counter null in turn; NaN entering recursive state (compare raw state, not scrubbed
   output); the enable transition; real composite CRDT shapes; a rejected rather than hung import; a
   callback before its deadline; exit zero beside a valid transcript; one case per adapter class.
   (#4068, #805, #5199, #4987, #2078, #4897, #5209, #4986, #2055, #5858, #2079, #4128, #5274, #4630, #5483)

9. **The case waits on time instead of the producer's signal.**
   Probe: await what the producer emits (a capability signal, an acknowledgement published by rename,
   a handler's first acknowledgement, a polling-start log, a producer-backed phase witness), never a
   sleep, a larger deadline, or a fixed microtask or frame count. Hold the real seam (snapshot wait,
   storage release, fallback timer), not a wrapper or a setter-injected microtask, and drive time-based
   readiness through the real progress producer. Delay the bad variant past the case's end: finishing
   before a scheduled side effect does not prove it was prevented, so the delayed mutant must still
   fail. Teardown must not depend on the behavior under test.
   (#5661, #5874, #5363, #5849, #5520, #5613, #5517, #3318, #5464)

10. **The case's deadline pays for work it does not observe.**
    Probe: name what each await waits on and measure headroom under the default deadline. Remove,
    batch, bound separately or split into named rows the work outside the assertion: cold imports (an
    unrelated stylesheet held past the case boundary must not reach the next case, an optimizer crawl,
    candidate compilation), fixture transactions, heavy renders looped inside an `it.each` body,
    multi-request setup, and population walks in one case. A raised timeout or warm-up hides the cost.
    Compose stage deadlines (escalation plus proof, navigation plus overlay, every retry attempt plus
    backoff within step and job budgets) and drive a stalled child through the loop. A wall-clock bound
    measures only the budgeted quantity; a count cap is not a deadline. Under induced engine or runner
    delay the case must still discriminate; a local green proves nothing about load-dependent roots.
    (#5191, #6011, #5964, #3270, #3356, #5459, #6000, #4775, #5798, #3222, #2976, #5337, #4228, #5115, #5924)

11. **Fixture state leaks across cases or depends on chance or the runner's environment.**
    Probe: hold a case past its real deadline in setup and again in its body. The successor must be
    refused before touching globals, the expired case must make no later assertion, cleanup must settle
    first, and removing the lifetime barrier must fail that ordered regression. Fix every
    nondeterministic input: actors on both sides of an Automerge merge (flip the chosen actor to the
    opposite extreme and expect red), ZIP `mtime`, clocks, inherited `GIT_TRACE2_EVENT`, and every
    environment variable read before the asserted one, under the variables CI exports. A spec must not
    run its subject on import or read refs, history or remotes its CI job never fetches (grep `origin/`,
    `HEAD~`, `merge-base` against each collecting job's checkout depth). Isolate inherited
    configuration and run under both CI values.
    (#5899, #4390, #5646, #5852, #4292, #4057, #4854, #3513, #4356, #5917, #2)

12. **One terminal observation hides an interleaving window.**
    Probe: hold the real seam between the guard's read and the write it authorizes (snapshot wait,
    commit publication, final provider response, OPEN snapshot, pending permission, in-flight pump,
    journaled pre-write). Inside it, change what the guard reads: move the head, reopen the parent,
    replace the root with a clone, commit a peer edit or pending store write, settle a grant, restore
    discarded history. Require refusal with zero writes and retained history and recovery evidence,
    plus a positive control that commits. Repeat terminal calls (Stop twice, dispose twice, reentrant
    flush, error after a grant, throw from one cleanup step) and count every reply and release.
    Removing the fence must fail the held case while the ordinary case stays green.
    (#806, #576, #2357, #4420, #5615, #5639, #4586, #5677, #5681, #2747, #5461, #5239, #5091, #5556, #4485)

13. **Project truth or output is observed in one place only.**
    Probe: assert raw CRDT, owner projections, both history stacks and the history tree together, and
    again after save, binary reload and session-mirror hydration with a global identity census. Replay
    history from bytes the untouched historical producer wrote, read by the current reader. Final
    equality can hide a write followed by restoration and notifications can miss a root install: count
    writes from a sentinel placed before the action, observe settled transitions, and compare any
    reported verdict with the final state it describes. Observe what the musician consumes (PCM against
    an independent input, decoded bytes, painted pixels, console output during load), not a flag,
    setter, DOM presence, returned length or metadata. Check fixture values real publication normalizes
    after hydration. Removing the producer, reload fence or copy must fail the case. For rejected
    partial merges, pair this with the real-store probe in `project-integrity.md`.
    (#4036, #5578, #5064, #187, #5013, #4904, #5649, #4564, #5157, #2169, #5274, #5812)

14. **The claimed boundary is replaced by a controlled one.**
    Probe: exercise the real thing the claim depends on: child pipes and process groups (a buffered
    parent read is not a Writable `false`, closed pipes are not group absence, only `ESRCH` proves
    absence, validate every PID before signalling), the default launcher and owner fence, a real Git
    DAG, the installed tool, the SDK in its server environment, the live GraphQL schema, the pinned
    scanner, the served entry under the production CSP, the compiled build rather than the dev loader,
    a transport buffer at production size. A configuration value, successful scan, snapshot or request
    count proves no runtime behavior, upload or comparison coverage; confirm the run checked the
    integration that lands. State the evidence scope: controlled engines prove the call path, not
    audible, hardware or cross-platform execution; a later pass does not explain an earlier failure; a
    comment about a third-party component is not evidence, so quote its primary source; a job that
    cannot run on the PR has its first hosted run as its only evidence.
    (#5624, #5639, #5240, #5115, #5320, #4271, #5615, #5705, #5595, #5363, #5331, #5284, #5243, #3548, #3170)

15. **A spec or report diff launders behavior or strands its sites.**
    Probe: for a spec-only red-to-green diff, read the product code each hunk observes and decide stale
    spec versus laundered defect. Under a preservation claim, a rewritten expected value is a
    contradiction to raise; recheck unchanged assertions in touched spec files and run the nearest
    untouched witnesses of the same surface. When a change declares "every X owes Y", census every
    existing X in a spec that reads the real files and cannot pass by matching nothing. When a
    published report depends on a qualified measurement, read the whole artifact, static summaries
    included, and require dependent claims withheld.
    (#2988, #3060, #1084, #974)

## Maintained end-to-end specs

Browser specs run only in the admitted run after approval and in nightly, so the reviewing head
carries no browser evidence for these probes.

E1. **A changed control strands the specs that locate it.**
Probe: when a diff renames, removes or replaces a control, or changes its enabled, disabled or
visibility condition, search `tests/e2e/` for the union of every form that locates it (test id,
aria-label or accessible name, placeholder, title, rendered text, role), never assertion names. In
each spec found, recheck every state read (`toBeVisible`, `toHaveCount`, `toBeDisabled`,
`toBeEnabled`, `toBeHidden`) and every `isDisabled()`, `isEnabled()` or `isVisible()` guard against
the new condition, and re-home it in the same change.
(#4464, #4479)

E2. **A new sibling makes a text locator ambiguous.**
Probe: search `getByText`, `getByRole(..., { name })` and `getByLabel` arguments case-insensitively
for the added element's text; keep each locator whose argument is a substring of the new text and
whose role can select the new element. Each must stay unambiguous or move to a stable handle; a
strict-mode violation or `.first()` selecting the wrong element is the finding.
(#4473)

E3. **A launch-route bridge crossing leaves a pinned call list stale.**
Probe: when a diff adds, removes or reorders a desktop-bridge crossing on a launch or
project-activation route, search `tests/e2e/` for the command string and exact runtime-call lists
(`desktopRuntime.spec.ts`) and update them in the same change.
(#4568)

E4. **A step's precondition is never produced, or its outcome cannot fail.**
Probe: name the state each added Playwright step's locator needs and trace it to the helper that
produces it (`launch_new_project` yields zero tracks). Create the asserted track and clip
deterministically, require editor admission before interacting, and give each advertised outcome a
readout that fails when the deciding canvas or selector is removed. Playback evidence needs two
distinct valid Bars.Beats.Ticks positions after start. Inspect the selected E2E result in PR CI.
(#1536, #1590)

## Release and provenance drift

The Release inventory step runs on every push. Inspect its result on the reviewed head; a pass on an
earlier head or a retry discharges nothing, and a missing restamp is the reviewer's finding.

R1. **A tracked-set source edit leaves its digest stale.**
Probe: for each surface boundary in `scripts/checkReleaseInventory.ts`, run
`git diff --name-only <base> <head> -- <gitPathspecs>` with its `:(exclude…)` entries, matching only
`gitPathspecs`, never the broader licensing `paths`. Any listed path requires
`release/open-source-inventory.json` to move in the same diff; `pnpm release:restamp:tracked-set`
refuses until the source change is committed.
(#5568)

R2. **A script, literal or name edit changes a provenance input.**
Probe: every `package.json` edit moves the Cargo source pin in `scripts/dependencyLicenseReport.ts`,
so the dependency restamp artifacts must move with it. Every new URL literal needs an
external-reference assignment whose removal exposes the exact missing reference. Every new device
type or registry name the mark census reports needs classification.
(#5642, #5625, #3127, #5846)

R3. **A merge or exception edit drops curated provenance.**
Probe: when resolving shared inventory, keep the union of curated external-reference assignments and
check the census against both sides of the merge. For a scanner ignore, run the pinned scanner on the
exact original commit: a finding without the ignore, none with the audited fingerprint, one with a
wrong fingerprint. Keep synthetic credential controls and evaluate every byte-exact reader of the
configuration (`scripts/test-health-gate-scripts.sh`) unchanged.
(#5851, #5746, #5748, #5846)

## Retired lessons

- Listing `vi.mock` barrel factories break when a diff adds a barrel export or import → enforced by `pnpm test:barrel-mocks` (`scripts/checkBarrelMockCoverage.ts`), Validation › Types and contracts › Barrel mock coverage
- A Vitest-green spec is not type evidence → enforced by `pnpm typecheck:test`, `pnpm typecheck:scripts` and `pnpm typecheck:e2e` in Validation › Types and contracts
- Rust-only changes skipped campaign fixture freshness → enforced by Validation › Types and contracts › Campaign fixture freshness, pinned by `scripts/__tests__/healthGatesWorkflow.spec.ts` "requires campaign fixture freshness for Rust-only changes"
- The required Rust job fetched its compiler before restoring caches → enforced by `scripts/__tests__/healthGatesWorkflow.spec.ts` "restores only an exact installed Linux compiler before setup and health gates"
- An exact Rust toolchain cache hit missing the host `rust-std` → enforced by `scripts/__tests__/ensurePinnedRustToolchain.spec.ts` "rejects an exact hit missing only the host standard library without installing", "rejects metadata-present host standard libraries that rustc cannot use" and "rejects an expected-name restore whose channel manifest declares another nightly"
- Literal launch-overlay waits below the shared first-paint bound → enforced by `scripts/__tests__/e2eLaunchOverlayBound.spec.ts` "gives every explicit overlay wait the shared first-paint bound"
- Don't Save guard reading its own load transaction as a newer transition, hidden by mocked authority at epoch 0 → enforced by `src/modules/Project/useCases/projectPersistence/__tests__/discardProjectChanges.realPath.spec.ts` "with a project-load epoch already activated" cases (lesson owned by `project-integrity.md`)
