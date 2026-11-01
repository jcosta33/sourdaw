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

Split out by defect class (a stance matching one carries that file, not this one): timing, deadlines, fixture state
and interleaving in `test-timing-and-isolation.md`; single-place observation and replaced boundaries in
`test-observation-scope.md`; maintained end-to-end specs in `maintained-e2e-specs.md`; release and provenance drift
in `release-provenance-drift.md`.

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
   spec's stderr clean. When a repair adds a `compile`-named production route, run the device-write
   boundary closure census and account for each new match by its actual runtime or document effect.
   (#2927, #5852, #5829, #1650, #2712, #3328, #4108, #5646, #4128, #5291, #4486, #4904)

3. **The test drives a helper while the production caller takes another route.**
   Probe: drive every real entry route (component, registered Command handler, bridge, dispatcher,
   planner, file admission, worklet schema, a selected as well as an explicitly opened target) through
   to the consumer that reads the value (sampler, ruler painter, metronome, billing, clip placement).
   Revert only the caller's use of the behavior (its dispatch, forwarding, or final consumer of a
   flag); the caller-level case must fail. A reader verdict, sanitizer, parser, handler `isNoop` or
   payload pinned in its own spec proves no admission. A helper that claims a production route ("one
   batch", "the fenced path") must emit that route's fence. For grounded protections, drive the
   ordinary bridge with the unresolved list, an unquoted whole-name collision, a quoted literal name
   and an edit of the protected object itself; edit Drums while leaving Bass alone, protect a selected
   object's descendants, and pair a fader-only protection with permitted processing on the same track.
   Unknown protected objects must clarify with no selection fallback. Move selection after the
   grounding basis, refine twice and compile a replacement targeting the formerly selected object: the
   recorded identity must still refuse. Assert empty actions and the refusal reason. Inject failures
   at the real stage after admission and observe the caller: a Faust factory rejection must refuse
   with the named track and device and produce no buffer, encode, write or download, invalidating the
   whole requested set, grouped stems and auxiliary detector keys included; a batch that commits while
   its history port throws must return a visible warning naming the committed result, never plain
   success; a failed control receipt must leave no staged authority for the next effectful call; a
   grouped replay whose older inverse conflicts (gain plus mute) must leave full project and history
   unchanged before its refusal feedback. Replacing an atomic path with a per-member loop must fail.
   (#3905, #2648, #1049, #5277, #5339, #4128, #2811, #2083, #5643, #5254, #5247, #5215, #474, #5798, #5565)

4. **A test double cannot fail the way the real boundary does.**
   Probe: type each mock from the exported callable and return its complete current result, so a
   stale owner result cannot pose as tested recovery. Fake a host receiver-sensitively, so an unbound
   method call throws. Derive fixtures from the producer's definition (live schema, upload-name
   template, the query the adapter emits), never from the consumer's regex or a hand-written response.
   Replace call spies and mocked authority with the real owner, and keep real state apart from any
   read projection that could hide it. Mutate what the double hid (drop `this`, change the result
   shape, add a segment, write outside the barrel, omit a still-present remote record from reads) and
   require the case to fail. Beside a valid commit, inject each extra write through the real store (a
   duplicate barrel action, an unrelated entity, a wrong value on an authorized field); with a real
   controller, fail the actual storage write once and repeat the cancellation. Read logged errors even
   when every assertion passes.
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
   would erase. For a clone, mutate every populated nested container of the copy to prove source
   isolation. Swapping in the looser or stricter comparison must fail the case.
   (#638, #1874, #2169, #471, #645, #5649)

8. **The fixture never holds the deciding input.**
   Probe: name the mutation that would get the rule wrong, place the deciding input where it errs, and
   require the unchanged case to fail when the fix is reverted. Escaped inputs: equal start and end
   timestamps plus a one-unit-narrower enclosure for every nesting comparison; first versus last event
   on one key; gestures on both sides of note-on and note-off; distinct values inside one tolerance; a
   full tempo excursion (180 to 60 to 180 BPM); a fractional change whose next tick is outside the
   window; an off-grid loop seam; layer and width cross-products; one frame past a cap; the highest rate
   the constructor admits; a fresh instance with no parameter write; the cold state before first Play;
   the last published id per family; budgets of zero and one over mixed holders; two omissions before
   completion; failure sequences whose reason must stay stable; a locked automatic row, and the same
   row after unlock; input that changes the detected population; paths containing diagnostic words
   (through injected catalogs only, since opening an adversarial filename can poison other lanes'
   global guards); exact classifier paths beside suffix lookalikes; each required counter null in
   turn; NaN entering recursive state (compare raw state, not scrubbed output); the enable transition;
   real composite CRDT shapes; a rejected rather than hung import; a callback before its deadline; exit
   zero beside a valid transcript; one case per adapter class. A family-wide claim needs every
   registered member (each handler of a shared transform map) crossed with missing, wrong-kind, frozen,
   locked and duplicate-ID targets, plus an ID duplicated after commit for replay; one representative
   cannot carry it.
   (#4068, #805, #5199, #4987, #2078, #4897, #5209, #4986, #2055, #5858, #2079, #4128, #5274, #4630, #939)

9. **A spec or report diff launders behavior or strands its sites.**
   Probe: for a spec-only red-to-green diff, read the product code each hunk observes and decide stale
   spec versus laundered defect. Under a preservation claim, a rewritten expected value is a
   contradiction to raise; recheck unchanged assertions in touched spec files and run the nearest
   untouched witnesses of the same surface. When a change declares "every X owes Y", census every
   existing X in a spec that reads the real files and cannot pass by matching nothing. When a
   published report depends on a qualified measurement, read the whole artifact, static summaries
   included, and require dependent claims withheld. A deliberate workflow edit updates its owning
   assertion and regenerated snapshot together: the snapshot diff holds only the intended change, and
   mutating that value (a depth-two checkout for a full-history edit) must fail the assertion.
   (#2988, #3060, #1084, #974, #5199)

## Retired lessons

Relocated, not retired: linked automation followers reaching the sampler (#931, #4392) in `saved-control-projection.md`; billed usage and provider-wire level fields (#4407, #2648, #4393, #4392) in `provider-egress.md`; recovery receipts and lock release (#5111, #3342) in `review-authorization.md`; canvas fresh paint (#5780, #5247) in `rendered-ui-layout.md`; the optimizer-reload HMR fence (#5874) in `e2e-server-provenance.md`; App import reattempt (#3356) in `startup-entry-availability.md`; rewrite destination ancestry (#4271) in `git-notes-preimage.md`.

- Listing `vi.mock` barrel factories break when a diff adds a barrel export or import → enforced by `pnpm test:barrel-mocks` (`scripts/checkBarrelMockCoverage.ts`), Validation › Types and contracts › Barrel mock coverage
- A Vitest-green spec is not type evidence → enforced by `pnpm typecheck:test`, `pnpm typecheck:scripts` and `pnpm typecheck:e2e` in Validation › Types and contracts
- Rust-only changes skipped campaign fixture freshness → enforced by `scripts/__tests__/agentCampaignHarness.spec.ts` "records each fixture as the tree actually holds it" (the digest-mismatch assertion), which Validation › Types and contracts › Campaign fixture freshness runs, with that step's wiring pinned by `scripts/__tests__/healthGatesWorkflow.spec.ts` "requires campaign fixture freshness for Rust-only changes"
- The required Rust job fetched its compiler before restoring caches → enforced by `scripts/__tests__/healthGatesWorkflow.spec.ts` "restores only an exact installed Linux compiler before setup and health gates"
- An exact Rust toolchain cache hit missing the host `rust-std` → enforced by `scripts/__tests__/ensurePinnedRustToolchain.spec.ts` "rejects an exact hit missing only the host standard library without installing", "rejects metadata-present host standard libraries that rustc cannot use" and "rejects an expected-name restore whose channel manifest declares another nightly"
- Literal launch-overlay waits below the shared first-paint bound → enforced by `scripts/__tests__/e2eLaunchOverlayBound.spec.ts` "gives every explicit overlay wait the shared first-paint bound"
- Don't Save guard reading its own load transaction as a newer transition, hidden by mocked authority at epoch 0 → enforced by `src/modules/Project/useCases/projectPersistence/__tests__/discardProjectChanges.realPath.spec.ts` "with a project-load epoch already activated" cases (lesson owned by `project-integrity.md`)
- A single-head view hid concurrent checkpoint-only descendants (#5681) → enforced by `src/modules/CrdtDocument/useCases/__tests__/projectRevisionMatchesLiveIgnoringCommandCheckpoint.spec.ts` "accepts checkpoint-only descendants of both captured root heads" and "rejects a branch project edit hidden by a captured sibling conflict winner", plus `src/modules/AiRuntime/useCases/__tests__/concurrentCheckpointApproval.spec.ts` "executes the original approval exactly once and retains its receipt and undo after checkpoint-only sync" and "refuses conflicting whole-map checkpoints without applying or rebinding the original approval"
- A projected Off erased committed On intent across an aborted repair (#5286) → enforced by `src/modules/Transport/useCases/__tests__/repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts` "rearms committed On when Off is projected %s and then aborted" (lesson owned by `project-integrity.md`)
- A held removal hid a committed retarget from runtime owners (#5283) → enforced by `src/modules/AudioEngine/repositories/audioRecorder/__tests__/removeTrackInputMonitoring.integration.spec.ts` "retires a hidden On owner after a committed selector change before its shared-input removal commits" (lesson owned by `project-integrity.md`)
