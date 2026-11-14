# Lesson library: test and evidence validity

A test, check or piece of evidence is invalid when it passes without observing its subject: its entry point is never
admitted, it drives a helper the production caller bypasses, its oracle is computed by the code under test, its pin
cannot fail alone, or its fixture never holds the deciding input. Each probe answers the baseline question from the
Review section of root `AGENTS.md` (what must break for this check to fail, and does it observe what its name claims?)
and carries its baseline mechanical probe unrestated: revert the behavioral hunk or apply one targeted mutation, run
the named spec, and a remaining green fails the round. Run mutations only on a committed head through [reviewer
isolation](README.md#reviewer-isolation). Report a probe that cannot run with its exact mutation, named check and
limitation, never as passed.

To record an escape, cite its pull request on the probe whose wording would have caught it. Add a
probe only for a failure mode none of these names; retire one only when a named check enforces it.

Split out by defect class (a stance matching one carries that file, not this one): timing, deadlines, fixture state
and interleaving in `test-timing-and-isolation.md`; single-place observation and replaced boundaries in
`test-observation-scope.md`; maintained end-to-end specs and their serving setup in `maintained-e2e-specs.md`;
release and provenance drift in `release-provenance-drift.md`.

## Standing probes

1. **Conditional admission: the case can finish without reaching its subject.**
   Runs: CI; the reviewer reads the "Affected end-to-end" jobs on the head for a Playwright case. From the fixed
   commit the reviewer reads whether any assertion is reachable only through the conditional; a Vitest case takes
   the mutation under the focused guard directly.
   A body inside `if (await locator.isVisible().catch(() => false))`, an optional locator, an early
   successful return, input sent to an element the consumer does not listen on, a parameter name the
   engine ignores, or a fixture on another branch can end green with no assertion. Probe: make the
   required entry point unavailable (rename its locator, unmount it, misname the parameter) and
   require the case to fail. Before any negative, assert the subject was admitted: the route selected,
   every input record consumed by the production reader, the valid control accepted, the write run.
   Admit the documented CLI under the real guard-owned `TMPDIR` on the target platform before
   crediting its cases. The server's `tsx --test` launcher (#1693) exceeded macOS's Unix socket path
   limit in guard storage and failed before collecting a case; `node --import tsx --test` retained
   the collaboration relay cases. Restoring the CLI under that long guarded path must fail at admission;
   the Node import route must execute the named spec. The missed probe was launcher admission;
   historical review draws are unknown.
   A dirty project name admitted only after an incidental autosave cleared its `Unsaved changes` status is the
   same defect (#5749, #5809): assert the real control while the dirty state holds, before waiting for Save or
   autosave, by its stable identity and a separate expected-name assertion, then make that control unavailable
   (rename its test id) and require the named case to fail at admission.
   Proof's benchmark (#974, retained by #1084; related level test #832) passed invalid
   `limiter_ceiling`/`limiter_threshold` names through an unchecked wrapper. Defaults could still
   sound and reduce about 0.36 dB, so even a negative GR reading did not prove the configured
   load. Drive the actual `buildDevices` recipe against committed WASM with canonical `input_gain`
   +6 dB and `lim_ceiling` -1 dB; require finite audible stereo PCM and over 1 dB negative gain
   reduction in both verification windows. Reverting the valid setter hunk must fail
   `crates/daw-dsp/benches/wasm/__tests__/deviceRecipes.spec.ts`. Historical review draws for
   these introductions were unavailable; do not infer their models or stances.
   Duplicate Rust `#[test]` attributes also duplicate admission: Levain's tone-history case
   acquired two attributes in #1002 (`1fdd29862146d80096b74fbe78e6cb0eb66f7d5e`). Read the
   collected names and count, not just the green total; the exact
   `re_engaging_after_bypass_continues_from_the_signal_not_from_silence` filter must execute
   one case. Removing only the redundant attribute must retain its PCM assertions. The
   introducing commit does not establish historical review draws; do not infer them.
   The piano roll numeric zoom assertion was conditional on the slider appearing (#1452): remove
   the required slider and require the numeric case to fail.
   (#4441, #1531, #1536, #1590, #5370, #2606, #4356, #4933, #5111, #4987, #5144, #5749)

2. **A negative case passes on the wrong refusal.**
   Probe: require the unmodified subject to pass a positive control on the same fixture, and require
   the refusal to name the injected cause (path, field, error class, reason). Disable only the guard
   under test while leaving any unrelated failure in place; the named case must fail. An earlier
   intake or schema refusal, generic rejection of an unregistered alternative, a setup lock, a changed
   fixture digest, a broad failure regex or an unrelated census mismatch must not satisfy it. Feed
   each guard its own violating row with every other precondition met, audit every new lexical match
   before updating a census count, and assert deliberate refusals through the thrown error with the
   spec's stderr clean. A full-project output delta can be refused by current-project topology
   validation before the intended live identity matcher decides (#5387/#5805): build output fixtures
   through the production `createWebAudioNode` compiler, require a positive control, and prove the
   injected mismatch is deciding by disabling only that matcher. When a repair adds a `compile`-named
   production route, run `pnpm guard --profile focused -- pnpm test:run
src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts` and account for each new match by its
   actual runtime or document effect.
   (#2927, #5852, #5829, #1650, #2712, #3328, #4108, #5646, #4128, #5291, #4486, #4904, #5387, #5805)

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
   An upstream already-projected integration delta cannot discriminate TrackNode's direct loops
   (#5387/#5805): add direct writer fixtures with full scheduled-instrument after-chains; reverting
   the reorder and replacement loops must fail their named direct cases.
   Guard output collection and mocked emission do not prove delivery through the CLI pipe (#3057):
   send output larger than pipe capacity through the real CLI and require the complete byte-exact
   body and markers for success and failure, correct channels and exit codes, and prompt exit.
   Check the bounded default failure tail and signal cleanup; restoring forced exit must fail
   `scripts/__tests__/resourceGuardShowOutput.spec.ts` "drains complete piped %s output when the child exits %i",
   beside "keeps the default bounded failure tail and reports omitted bytes through the CLI" and "exits on %s after
   its child has stopped".
   Public Enable Audio Warping wrote only a preview Map and declared undo without an inverse while its specs
   asserted mocked delegation (#415). Drive the registered public action with an off-mode audio clip carrying a
   non-unit ratio, a keeper clip and a prior independent edit. Require raw CRDT and projected clip mode, the real
   history metadata and inverse, repeated-enable no-op, exact Undo/Redo, and missing/MIDI target non-effects. The
   real offline playback projection (`projectOfflineAudioClipPlaybacks`) must change rate with enable and Undo.
   Restoring the preview-only route or dropping the inverse must fail
   `src/modules/AudioEngine/handlers/finalFeature/__tests__/publicWarpActionsAuthority.integration.spec.ts` "enables
   repitch from %s with exact undo/redo and durable history", whose rate assertions observe that projection; a mock
   call cannot prove clip enablement, output or reversible project history.
   Fermenter macro keyboard cases awaited an unrelated `oscLevel` scalar while macro/mapping arrays could be lost
   (#6321; provenance in `command-entry-and-state-oracles.md` probe 2). Drive the rendered controls and real
   macro/morph bridge through Command/CRDT, then read the complete authoritative device chunk, fresh hydration,
   declared history behavior and engine projection. Removing array persistence must fail
   `src/modules/Fermenter/presentations/views/__tests__/fermenterPatchAuditionUndo.integration.spec.tsx`
   "persists $label arrays in raw truth and fresh hydration after a whole patch" for both macro and morph; a
   persister spy, numeric mirror or unchanged neighbouring scalar is not that oracle. Require the same real owner
   cases to observe pending M → N → Undo M → Redo N and stale queued refusal in project, UI and runtime. These
   in-memory observations do not replace actual save/binary-reopen, browser or audible acceptance when claimed.
   An edited audition is a weak owner probe for PR #6506: the patch mismatch can clear stale A/B even if a plain
   preset's equal local echo would retain it. Pair the edited control with the maintained “retires an unedited
   preset audition” project and same-ID device replacement cases, and assert both rendered slot buttons disabled
   after raw owner replacement. Reverting owner observation must fail those cases; a value-changing fixture alone
   is not the owner oracle.
   (#3905, #2648, #1049, #5277, #5339, #4128, #2811, #2083, #5643, #5254, #5247, #5215, #474, #5798, #5565, #5387, #5805)

4. **The oracle is computed by the code under test.**
   Probe: take each expected value from an independent source and write it as a literal stating its
   source: the consumer's boundary (`JSON.stringify` byte length against the provider ceiling), the
   documented contract (an inclusive billing total), independent arithmetic (seconds from a tempo
   ramp's integral), or real public commands run from the same prestate. Two chunkings through one
   copy path, a helper repeating the production mapping, an expectation derived from the helper's own
   constant, and an untraced anchor prescribed by the orchestrator are self-consistent and cannot
   redden. Mutating the shared expression must fail the case. An exact count or shape must derive from
   the thing observed, not from what the code currently produces.
   A dependency version and an unchanged bigint literal cannot prove setter preservation. Magicast's
   setter in the package admitted by #6285 printed `101n` as the number `101`; the earlier bug origin
   and historical review draws are unknown. Run the real module's parse → setter → print → reparse
   route, asserting the independently specified bigint value and runtime type. Reverting the native
   `BigIntLiteral` setter fix must fail the bigint case in `scripts/__tests__/babel8Consumers.spec.ts`.
   (#4491, #4393, #5239, #5437, #5723, #5243, #5323, #5495, #5578)

    #1857's batch prefix projector (`064fb88392`, historical review stance unknown) retained -100 where the real
    cutoff writer clamped to 20 Hz. Compare a literal descriptor boundary and the real writer to the planned
    prefix; deriving both expected and actual from the same projector hides the divergence. The owner case in
    `projectTrackThroughPriorBatchActions.spec.ts` must fail if its shared scalar clamp is removed. Mixed recorded
    macro tests read `undoHistoryStore`, the full public history contract: the label-only `undoStore` cannot
    witness grouping, captured inverses or replay authority.

5. **A pin cannot fail on its own.**
   Probe: mutate the input each added assertion reads, neighbours as shipped, and require it to fail
   alone; run it alone and after its preceding cases, since cached registration can mask a guard.
   Shapes that observe nothing: a pin after one already fixing the value, a relation with slack, a
   first-match parse, a ratio from a pinned neighbour, `toHaveBeenCalledWith` where a second reply was
   lost (count calls), whole-note RMS hiding a dip, and an absence check masking the guard mutation.
   Select every `expect\([^)]*\|\|` hit and mutate each arm away; each arm must redden.
   (#4491, #4473, #5091, #5227)

6. **Equality in the oracle differs from equality at the boundary.**
   Probe: compare with the boundary's semantics. For optional fields use `toStrictEqual` or
   `Object.hasOwn`: absent stays absent, explicit `undefined` is distinct, a defined zero survives.
   Cross a fresh projection with reordered keys and a replaced projection object holding equal values:
   equal values must be admitted, changed values or array order refused. Keep CRDT scalar types JSON
   would erase. For a clone, mutate every populated nested container of the copy to prove source
   isolation. Swapping in the looser or stricter comparison must fail the case.
   (#638, #1874, #2169, #471, #645, #5649)

7. **The fixture never holds the deciding input.**
   #2591's 4 MiB ASCII capture fixture (`5cfdc662e38e`, historical reviewer tier and prompt unknown)
   could not discriminate raw-byte preservation or a full-review diff exceeding the ordinary cap.
   Include non-UTF-8 bytes and a one-byte replacement that decodes identically: the intact Git patch
   must bind, and the replacement must fail publication in `scripts/__tests__/prepareReview.spec.ts`.
   Lower real-child limits in a small fixture to prove overflow refusal, and check the exceptional
   allowance at both production full-diff callers rather than enlarging every capture's default.
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
   cannot carry it. Worker detection must distinguish pending from committed with a held Worker and exercise real
   Undo/Redo plus divergent refusal. Its author-recorded performance evidence must time a real 120-second source from
   click through PCM copy, cold Worker, atomic commit and UI completion, with frames and main-thread tasks recorded
   over that same interval; the reviewer checks the recorded interval covers all of it. Native document parsing
   and JS-root materialization are separate costs even when one public load call combines them (#5843).
   Moving either stage outside an existing named measure must leave it inside the full click-to-completion
   long-task gate. Hold the parsed handle before adoption and require abort or replaced authority to free it
   without publication. A mock that always returns
   empty hits proves neither suppression nor completion.
   (#4068, #805, #5199, #4987, #2078, #4897, #5209, #4986, #2055, #5858, #2079, #4128, #5274, #4630, #939)

8. **A spec or report diff launders behavior or strands its sites.**
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

9. **A fake runner proves argv but never enters a worker.**
   The zero-test wrapper coverage introduced in #2423 used a fake executable that writes a JSON
   report. That seam proves report and exit handling, but cannot establish whether a real runner
   queued a module, a worker entered setup, or an import blocked before collection. Run a tiny real
   Vitest fixture through the wrapper, hold an import after worker setup, and assert the persisted
   stages on both sides of that boundary. Remove the reporter or setup marker to make the fixture
   fail; process presence alone is not a worker-admission oracle. (#5231)

10. **An archive fallback probe misses an installed-legal admission (#2731).** The original
    `binds Cargo proof evidence to its locked crate archive` case supplied `legalFiles: []` and
    called the proof helper directly. It could not observe the production return for complete
    installed legal bytes. Require `dependencyLicenseReport.installedSources.spec.ts` to generate
    through actual metadata/manifest/legal/archive consumers, doubling only Cargo metadata and pnpm
    inventory boundaries. Removing universal source authentication before the retained-legal return
    must fail the genuine-MIT git-source case, while authenticated registry/local sources remain
    positive. No historical review tier or prompt is inferred from the introducing PR.

## Retired lessons

- Listing `vi.mock` barrel factories break when a diff adds a barrel export or import → enforced by `pnpm test:barrel-mocks` (`scripts/checkBarrelMockCoverage.ts`), Validation › Types and contracts › Barrel mock coverage
- A Vitest-green spec is not type evidence → enforced by `pnpm typecheck:test`, `pnpm typecheck:scripts` and `pnpm typecheck:e2e` in Validation › Types and contracts
- Rust-only changes skipped campaign fixture freshness → enforced by `scripts/__tests__/agentCampaignHarness.spec.ts` "records each fixture as the tree actually holds it" (the digest-mismatch assertion), which Validation › Types and contracts › Campaign fixture freshness runs, with that step's wiring pinned by `scripts/__tests__/healthGatesWorkflow.spec.ts` "requires campaign fixture freshness for Rust-only changes"
- The required Rust job fetched its compiler before restoring caches → enforced by `scripts/__tests__/healthGatesWorkflow.spec.ts` "restores only an exact installed Linux compiler before setup and health gates"
- An exact Rust toolchain cache hit missing the host `rust-std` → enforced by `scripts/__tests__/ensurePinnedRustToolchain.spec.ts` "rejects an exact hit missing only the host standard library without installing", "rejects metadata-present host standard libraries that rustc cannot use" and "rejects an expected-name restore whose channel manifest declares another nightly"
- Literal launch-overlay waits below the shared first-paint bound → enforced by `scripts/__tests__/e2eLaunchOverlayBound.spec.ts` "gives every explicit overlay wait the shared first-paint bound"

## Relocated

- A test double that cannot fail the way the real boundary does (#2097, #4496, #1949, #5705, #4577, #5649, #474,
  #2597, #4271, #2811, #5639, #2035) → `test-observation-scope.md` probe 6.
- Linked automation followers reaching the sampler (#931, #4392) → `command-entry-and-state-oracles.md` probe 3.
- Billed usage and provider-wire level fields (#4407, #2648, #4393, #4392) → `provider-egress.md` probes 5 and 6.
- Recovery receipts and lock release (#5111, #3342) → `review-authorization.md` probes 7 and 8.
- Canvas fresh paint (#5780, #5247) → `rendered-ui-layout.md` probe 4.
- The optimizer-reload HMR fence (#5874) → `maintained-e2e-specs.md` probe 8.
- App import reattempt (#3356) → `startup-entry-availability.md` probe 4.
- Rewrite destination ancestry (#4271) → `trusted-script-delivery.md` probe 6.
- Device automation receipts reset by ordinary immutable edits, and the post-Redo manual baseline (#1648, #3847) →
  `session-lifecycle.md` probe 9.
- Stored undeclared automation keys accepted by carrier fixtures (Knead `shift_semitones`, #807, #831) →
  `project-integrity.md` probe 13.
- Empty linked followers proved by a getter instead of the runtime caller → `project-integrity.md` probe 14.
- Don't Save guard reading its own load transaction, hidden by mocked authority at epoch 0 (#5573) →
  `replay-authority.md` probe 5 and its Retired lessons.
- A single-head view hiding concurrent checkpoint-only descendants (#5681) → `replay-authority.md` probe 5 and its
  Retired lessons.
- A projected Off erasing committed On intent across an aborted repair (#5286) → `input-monitoring-ownership.md`
  Retired lessons.
- A held removal hiding a committed retarget from runtime owners (#5283) → `input-monitoring-ownership.md` probe 6.
