# Standing probes: behavior and invariant defects

The generic defect class a derived stance must specialize beyond, never a stance name to dispatch: the
change does something other than what it claims, or breaks an invariant its callers, readers, replays
or siblings rely on. A behavior-risk stance matching no more specific file carries this file; a stance
with a more specific match never carries it in addition. Each probe names the failure mode, the input,
state or mutation to run, and the check that must go red. Report the concrete break or none.

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
   and require the mounted reader to follow without a pointer refresh (Elastic markers; selected-only
   target resolution); write points to a linked follower the sampler ignores (#4506). Ask what a
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
   5.4..5.6) and must adopt the segment boundary's exact origin once. Validate the entered unit and
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
    #2083, whose Undo must change the existing live chain rather than send an initialization snapshot).
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

## Saved projects and replay

15. **Identity namespaces across reload and replay.** Produce entries through real Command, save and
    load the Automerge document, reset every projection and hydrate the session mirror, then require a
    global ID census, exact values and real Undo/Redo. Split before surviving points: retained copied
    IDs must reserve the live namespace, including a preoccupied preferred ID under another owner, an
    ID claimed by a peer after Undo (zero-write refusal), nested points and cross-domain owners
    (#4036), at a dyadic and a non-dyadic cut. Producer-local scopes stay local: canonical clip-local gain point IDs repeat across clips
    and equal a track ID, while same-envelope duplicates, track/clip/device collisions and repeated
    arrangement IDs stay repair-required. For a batch-admitted restored clip preceding a split, compare
    captured IDs with the committed IDs before reloading and replaying twice; a live execution that
    remints a preflight capture is not replay-stable. Read executable entries from the full history
    owner, not its label-only view; draw is singleton-only, so a rejected draw/split proves admission only.
16. **Saved inverse authority.** Probe a saved inverse through production hydration before any write:
    duplicate note identities, malformed CC or bend rows, a missing capture, one side of a mirrored
    optional satellite absent (present empty is distinct), and a durable-head change alone must not
    refresh a removal inverse (#5064). Add Redo after unrelated same-track growth (#1425 slot), a
    cross-track move's source order after a peer removal (#515), and split Redo with a recreated target
    identity. Mocked minimal rows cannot show the restore owner admits what Arrangement already wrote.
17. **Lossy import accounts for the whole source.** Enumerate the legal source grammar and account for
    every preserved, omitted or partially kept element, including named descendants under rejected
    owners and malformed, nonnumeric, nonfinite, empty and whitespace-only values against the actual
    parser fallback (DAWproject, #5656/#5795). Assert warning identity, owner, order, cardinality beside
    playable siblings; remove each accounting branch and its case must fail.

## Audio, timing and format laws

18. **Tempo projection in both directions.** Trace seconds to beats and beats to seconds from captured
    tempo state to every terminal binding (AudioParam, segment writer, curve writer; track, clip, absent
    lanes) on a flat tempo and a ramp from a nonzero anchor, with an independent integral. Trace the real
    render origin through history expansion before prescribing a crop anchor (#5323); a private
    step-only inverse or lost anchor must fail the terminal-output case (#5209/#5243): include both
    moving-layer schedulers and stem branches, quantisation, slew and the compensated write clock, and a
    layer whose beat-zero value differs from its requested-start value under a tempo ramp.
19. **Musical law against DAW convention.** State the law an established DAW applies and evaluate at
    two grids (1/16 and 1/4); quantize the output again and require it unchanged; a result no reference
    DAW reproduces is a finding unless a decision record names the difference (#4788). Mapped ruler
    paint must follow the model's physical bar origins, not an inverse over bar names (Insert 2 at 4 in
    4/4 carries the origin to 6 and moves the clip at 8 to 10; two partial pieces can share a number);
    cover partial bars, denominators other than 4 and a later meter change.
20. **Fresh instance, highest rate, whole signal.** Render a fresh instance without setting the
    parameter under test and compare with explicit values (default routing); measure the actual engine
    at the highest admitted context rate for late tail and silence after the physical duration; compare
    mid and side impulses with an independent ideal delay. Trace enable transitions on sustained
    input: short-window output and gain against an already-open reference (zero crossing, near-threshold
    detector), enable-time hold seeding, and a single NaN or infinity compared sample for sample with a
    healthy reference through attack, hold, release and reopening; an output scrub proves nothing about
    recursive state. Revert only the default, cap or fence and the named PCM case must fail; follow the
    source through regenerated served WASM when the claim is about the shipped carrier.
21. **Format conformance by an independent decoder.** Compare real encoded output through the shipped
    decoder against the originating PCM at each bit depth, including container checksums and decoder
    warnings (FLAC Rice polarity per RFC 9639); reverting the grammar fix must fail the parity case.

## AI action bridge, prompt segmentation and request authority

22. **Context and cancellation at every dispatcher route.** Drive execution context through single and
    batch dispatch and both runtime and project handlers; prove cancellation and deferred-work attempts
    at a real consumer; dropping context on the single-action entrypoint alone must fail a case.
23. **Segmentation keeps each action's qualifiers.** Vary connectors and punctuation; each action keeps
    its own exclusions and reference ambiguity without borrowing adjacent action text; mutate literal-ID
    vs display-name evidence and Unicode-overlap evidence. An exact identifier must not erase genuine
    ambiguity and a clause boundary must not widen a destructive action or collapse competing targets.
24. **Deterministic admission consumes the whole request.** Test a complete exact command across the
    registry before complexity heuristics; reserved context references resolve before unquoted names; an
    unquoted multiword value is semantic unless a bounded grammar proves it literal. Feed fuzzy rank,
    partial text, context availability or first registry match and require a refusal.
25. **Source authority and protections come from the original text.** Masked text serves discovery and
    segmentation only; it never proves literal source syntax or target authority. Deterministic, direct
    and compiler-backed proposals derive authority from the same original text and the same complete
    selection set: a primary selection field does not prove the selection is unique, and
    compiler-resolved identities validate selector structure only. Parse quote boundaries once,
    offset-preserving, in-word apostrophes as content;
    reserved selection phrases apply outside quotes only; mask spans are immutable and a generated marker
    never becomes evidence. Resolve each list member independently, union protected candidates, treat an
    incomplete protection as rejection, enforce after final target resolution including compiler
    overrides. When a value can contain the connector, enumerate quote-aware source boundaries, ground
    each prefix completely (including a complete known owner qualifier; a contained name is
    insufficient) and admit one unique interpretation, never letting a provider target choose between
    competing boundaries. Where a grammar permits an optional connector, classify source and value from
    one quote-aware parse and keep semantic whitespace inside a protection reference without joining
    separate punctuation-bounded clauses.
26. **Protection owner, polarity and exceptions.** Probe a name shared by track and clip
    (`leave Bass Verse unchanged` must not freeze the track, `leave Bass fader unchanged` is control
    authority, #2811); later admission against a frozen whole owner's actual descendants, and
    independent `leave Bass alone` and structural or frozen roots kept as whole restrictions beside a
    separately protected clip, with a track and a clip or device sharing the exact name; a reserved phrase colliding with a display name, quoted compound owners,
    title-cased qualities, unclosed VCA quality; a fader exception permitting gain but refusing pan and
    rename; selection retained through pending-card refinement and compiled replacement; independent
    clauses and later protections restricting, never widening; a compatibility mask consuming the whole
    clause (#5339). Catalog candidates come from fully consumed resolved spans with unknown protected
    objects clarified (#4128); a required insertion anchor is checked before optional-field omission,
    with missing and wrong anchors writing nothing (#1650/#2811).
27. **Direct-level inventory is catalog-wide.** Enumerate every planner-emittable direct-level command
    and trace schema, prompt binding, strategy, handler, stored value, undo and full/delta context;
    test absolute and relative decibels, the owning ceiling, silence and legacy linear values at actual
    execution (#4366); VCA and metronome fell outside the first enumerated family list, so a passing
    sample of those families cannot prove the remaining catalog.

## MIDI

28. **Note-correlation regressions cross the rack boundary.** When a transform stores a Note On decision
    for a later Note Off, drive supplied `noteInstanceId` values through `MidiRack`: one equal-pitch note,
    change the deciding parameter while held, then attack and release a second identity first. Assert
    emitted identity and pitch or suppression; channel/pitch FIFO must fail. Keep identityless FIFO apart.
29. **Expression ordering around note release.** Hold the note-on's async worker, admit pressure, CC74,
    bend, release and the next same-channel note; read the curve points and execution order; an idle
    unrelated channel stays immediate (#805).

## Trusted scripts and delivery

30. **Invoke the real route with default dependencies.** Trace a new capability from the package
    command through the protected launcher to its consumer and run it with controlled remote ports and
    the default owner fence; observe the acquired process identity before the first PR read. Omitting
    the command from the launcher's fenced set, or restoring a direct package route to the transaction
    script, must fail before remote I/O; lock fixtures that inject owner fences cannot show it (#5639).
31. **Validated tree vs merged tree.** When the base tip moved after the head's last run, especially
    in the same file, require evidence covering base plus head; reverting either hunk must fail it (#5243).

## Retired lessons

- Optional-effect probe throwing in a Faust compiler upgrade (#4904) → enforced by `compileFaustDSP.spec.ts` "compiles the registered Supersaw voice without probing an absent effect".
- Tooling paths missing from the browser selector or validation path filter (#4854, #4902, #4484, #4932, #4933) → enforced by `scripts/__tests__/prValidationScope.spec.ts` "keeps known review tooling security checked without browser execution" and "admits exact review helper source and matching spec %s".
