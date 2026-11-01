# Standing probes: behavior and invariant defects

The generic defect class a derived stance must specialize beyond, never a stance name to dispatch: the
change does something other than what it claims, or breaks an invariant its callers, readers, replays
or siblings rely on. A behavior-risk stance matching no more specific file carries this file; a stance
with a more specific match never carries it in addition. Each probe names the failure mode, the input,
state or mutation to run, and the check that must go red. Report the concrete break or none.

Split out by defect class (a stance matching one carries that file, not this one): saved projects and replay in
`saved-project-replay.md`; audio, timing and format laws in `audio-timing-format-laws.md`; AI action bridge, prompt
segmentation and request authority in `ai-request-authority.md`; MIDI note correlation and expression ordering in
`midi-note-correlation.md`; trusted scripts and delivery in `trusted-script-delivery.md`.

## Standing probes

1. **Hunk-only reading.** The hunk shows what changed, not what the code now does. Read the function,
   its callers and its callee contracts at head; state the invariant in one sentence; construct the
   violating input. Where the change touches a shared control, read the sibling components on the same
   surface first: their comments carry measured browser behaviour (`lostpointercapture`, a tab switch
   with no `pointerup`) the change must survive.
2. **A check that observes nothing.** Name what must break for each existing check to fail. Probe:
   destroy the value after the assertion, or apply one targeted mutation, and run the named spec; still
   green fails the round. Blind forms: a fixture that sets explicitly what a fresh instance defaults
   (Bacteria Serial vs Parallel, #2079) or passes a key the engine ignores (`routing` vs `globalRouting`,
   #2606); a spec that pins the deviation (quantize swing, #4788); callbacks applied to a mock where the
   project must retain the value (Freeze failure reason, #2597); a mock above the layer that hides the
   defect (backend truncation, #4128); a setter-injected microtask standing for the production receive
   protocol; metadata equality standing for delivered audio.
3. **A model of another component's state.** A mirror, shadow copy, bitmap, or projection must carry
   every clause of the owner's contract, including those no test exercises. Probe: enumerate the clauses
   from the owner's source and drive the one-poll-interval-inside case of each (loop-end seam half of
   `proven_popped`, #3363); render the persisted state the owner refuses (enabled mapping to a
   nonautomatable parameter must show no Inspector halo, #831/#5379); change the owner after detection
   and require the mounted reader to follow without a pointer refresh (Elastic markers; the real
   slider with a selected clip and no open editor must change authoritative automatic markers while
   locked/user rows, another clip and PCM stay exact, and selected-only resolution must not override an
   explicitly opened editor; do not open the editor to satisfy the test); write points to a linked follower the sampler ignores (#4506). Ask what a
   one-bit-per-key model cannot represent (two of one key, an order, a count).
4. **Population and producer sweep.** When a detector, sanitizer, adapter or narrowed store rule
   asserts an invariant over a registered population or every writer of a record, enumerate every member
   and producer at head and drive each through the new clause; the population, not the incident, bounds
   the sweep (#3112: promotion wrote `sourceRevision` for generic effects). Name the throw any empty
   catch around persistence hides and construct the input.
5. **Witnesses outside the author's list.** A change to a durable record's contents or to a UI label,
   selector or layout has readers the author did not name. Grep `src/**/__tests__`, `tests/e2e/**` and
   `scripts/desktopLatency*.ts` for the field, type, literal placeholder or label, name every hit, and
   require a run of each (`pendingEffectContinuations`, #3506; compact StatusBar moved "Out" behind a
   popover the nightly harness reads by label).
6. **Boundaries and quantized clocks.** Probe one quantum each side of every boundary: the value the
   report named and its neighbour. On a quantized clock list every strict inequality and require each
   remaining one justified by uniqueness (trace binder starts vs ends, #4068); cluster tolerances need
   several distinct values inside it, with and without an exact-zero member (near-zero tempo, #5199);
   a widened tolerance or threshold changes which population is admitted, so construct an input inside
   the new band (`joinNotes` joined stacked same-pitch notes at `gridSize/8`); finite windows must also
   hit a fractional change origin before the outgoing next tick (meter seam 4/4 to 3/4 at 5.5, window
   5.4..5.6) and must adopt the segment boundary's exact origin once, even when another distinct origin
   is within grid rounding tolerance; keep equal-point queries, negative starts, inclusive right
   tolerance and last-change governance at duplicate beats. Validate the entered unit and
   segment, not only the initial one: drive an invalid later unit and a walk finite arithmetic cannot
   advance, and require the valid prefix. Frame limits get the `2^30` boundary (`2^30 + 1` requested vs
   `2^30` returned, with and without tail, nonzero start). Trace binder: equal end timestamp and one
   unit early, pairing unique, real overrun and ambiguous overlap still refused.
7. **Hand-decided grammar.** A hand-rolled recogniser fails in two directions. Enumerate the
   grammar-legal forms the rule does not name (nested property, parameter, return, annotation,
   conditional branch, mapped type, decorator, union member) and drive each with the named member first
   and after another member, plus a genuine computed load as positive control, since an empty result is
   otherwise indistinguishable from a scanner that never ran (#4775/#4835). Pinning refused forms states the bound; it does not fix it.
8. **One enforcement route of several.** A rule enforced on one route admits the same request on
   another. List every route that returns actions or reads the state (direct, coordinated, atomic,
   compiled, refined; constructors' defaults, releases, removal arms, re-deriving commands; dispatcher
   single and batch entrypoints, #1949/#2988) and drive each with the same request; a route that never
   reads the verdict is the finding (clip-protection completeness, #4929). When a diff retires or stubs a
   renderer, list every routing rule that can still deliver the thing to it and run the smallest project
   (one track, that device) plus the product's standing consumers (#3593/#3846). A new stored row kind
   must pass every reader's admission gate on a take made of only that kind: restore each reader's skip,
   and a controller-only clip with no note list must go red (#5338); fix the reader, never write a
   placeholder into shared CRDT state. A doc sentence calling two commands atomic must say whether it
   means visibility-atomic or success-atomic and what a refusal leaves behind.
9. **The record the real producer sends.** Admission checked against the acceptor's vocabulary rather
   than the producer's output fails live. Build what the producer ships for a freshly created object
   (Fermenter camelCase `parameterValues` vs snake_case engine keys) on a contributing and a
   non-contributing strip, list every mapper branch that degrades to omission rather than refusing, and
   require any refusal reachable on the new type to obey the same law; list every acceptor on
   the path (handler, payload validator, executable registry schema and `required`, strategy key set,
   grounding rules, provider serializer in full and delta forms, #4392/#4366) and drive one call
   carrying the new form end to end (change and remove a clip gain, send level and gain-lane bound on an
   unselected retained track: the delta must carry the pair or removal, full and delta one law header). Trace each added provider tool or schema through every backend's
   advertisement under its cap (#4128), a command with nonempty arguments through the strict wire and
   back (#4882), a declared control key through the production parameter schema to the worklet (`convolutionIr`,
   #5254, every Body index), a mono source through the real factory in Chromium (#5034: Auto Pan right
   peak, Widener equal L/R, asymmetric stereo control). Published candidate ids must be
   pairwise distinct and every selectable object type reachable; a counter read inside one variadic
   call sees the pre-call length for every argument.
10. **The outcome that happened, not the one requested.** State written after a call is attempted, a
    result assembled before finalization, or a success returned over an unperformed effect are
    unrecorded failures. Probe: reject, absent, defer and overlap the real dependency and read the
    store, document and result (output sink after `setSinkId` rejection; storage cleanup after the
    result was built, #5274; a void replay marked Reverted for an absent group, #5565; Faust runtime
    failure inside a musician export, #5215; short offline render placed at the requested end, #5013/#4986;
    guarded solo whose target already holds, #5643; device delta against an uninitialized live strip,
    #2083: complete a MIDI import, leave the strip actually absent, and run Remove Synth with no Play
    gesture, since a Play masked the missing strip; Undo must change the existing live chain rather than
    send an initialization snapshot; reverting the missing-strip admission must fail the cold Command case).
    Specific inputs: overlapping sink requests wait for their predecessor; a plain-click exclusive solo
    makes the guarded inverse target already hold, so Undo consumes the entry with no root, revision or
    projection write and the next Undo reaches the older entry (Redo likewise; keep the differing-live,
    missing-track and unguarded-overwrite controls); a committed warning keeps the whole revert consumed,
    an unexpected replay failure reaches visible error without an abandoned rejection.
    Require unchanged project, history and visible refusal where it did not happen; a grouped stem or
    auxiliary detector failure invalidates the whole requested set.
11. **State read at start, trusted at commit.** A decision reached before a concurrent writer acts must
    be rechecked or serialized with that writer. Probe: pause the first invocation after its read, run
    the second through the real entrypoint, then release the first (OPEN compensation erased adopted
    markers, #4420; recovery deleted a receipt it did not start from and discarded the unlink result,
    #3977; optimistic Undo replay hydrated away a peer edit, #5520/#5613 in both admission orders and
    each late-peer owner). Retaining the journal or lineage is not enough: post lineage 1001, then add
    finding 1002, and require the complete updated lineage to succeed on retry without relaxing marker
    validation; pause one invocation after its OPEN snapshot and the second real entrypoint must refuse
    before any PR port call. Write a replacement receipt inside the recovery child before it returns 0
    and require non-zero with the replacement bytes kept; a throwing unlink must be reported. Require
    either both edits or zero-write refusal with history pending. Track
    presence does not certify the restored programme: race MIDI notes, controllers, clip automation,
    gain and warp owners separately; ambient owner equality inside an entered transaction scope does not
    certify newly authored intent, so interpose publication and hydration there; check both the
    immutable root and the prospective mutable document, since proxy identity is no ownership witness.
12. **Limits measured by the consumer, at the largest answer.** Re-derive the consumer's own expression
    and measure the worst admitted unit with it: `JSON.stringify({state, questions})` vs the planner's
    hand-built wrapper (#4491); the single-type request vs the per-call receipt budget (#2011); a
    sample cap vs the highest admitted rate (4096 at 192/384 kHz, #2055/#5858); a self-declared budget
    vs the producer's fixed deadline with zero, negative and `1e309` costs (#2725); filtered keyed
    measurements must keep producer keys (invalid middle calibration plus a missing referenced tail,
    #974). Request each type alone: a `legalSet`-declaring descriptor was the reproduction (#2011).
13. **Refusal attribution and reallocation.** For every refusal added or moved, state which units it
    stops and what reason each records; a per-unit property read as a run property reports unrelated
    units under a cause that never happened (#4491). A rank or order added for one pairwise inversion
    reallocates a binding total: compare planned units and reasons against the merge base on a fixture
    wide enough for the total to bind (collected specs plus covered sources, with a deleted, an
    over-ceiling and a credentialed path), never aggregate counts (#4826).
14. **Release and transition rules for timed or stateful stores.** State the ordering rule, the release
    rule for every way playback leaves the timeline (stop, locate, loop wrap, window clear) and the
    per-occurrence rule for repeated keys. Probe: every window a scheduler opens is projected against
    the loop end, including one a late wrap opens at `loopStart` (stalled tick within one look-ahead of
    `loopEnd`: loop 0..8 at 120 BPM, a clip after the loop, tick at 7.975 s after a 0.05 s tick; nothing
    posted at or past `loopEnd`, seam armed, next pass's beat 0 lands on its frame, #6004); a readiness
    deadline measures progress, not elapsed cohort time, and decoded is not worklet-acknowledged
    (#3318/#3982): at 39 of 161 files just before the old deadline all five consumers must still finish
    ready without rollback; one peer stalled for its own inactivity window while another progresses fails
    only the stalled peer; obsolete cancellation stays silent.

## Retired lessons

- Optional-effect probe throwing in a Faust compiler upgrade (#4904) → enforced by `compileFaustDSP.spec.ts` "compiles the registered Supersaw voice without probing an absent effect".
- Tooling paths missing from the browser selector or validation path filter (#4854, #4902, #4484, #4932, #4933) → enforced by `scripts/__tests__/prValidationScope.spec.ts` "keeps known review tooling security checked without browser execution" and "admits exact review helper source and matching spec %s".
