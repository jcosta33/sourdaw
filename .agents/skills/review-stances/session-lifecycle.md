# Standing probes: runtime session lifecycle

Defects in anything that starts, stops, parks, replaces or disposes a long-lived runtime the app holds on behalf of
a user-facing mode: the native live graph session, the playhead scheduler and feed, a recording session, the
input-monitoring capture, a plugin host instance, a collaboration transport. A lifecycle stance carries this file.
Each probe names the failure mode, the input or state to drive, the check that must go red and the mutation that
must fail it. Controlled ports (media, graph, scheduler, wall-clock) prove ordering, ownership and cleanup; they
never establish physical hardware audibility. Runtime-monitor companions to `project-integrity.md` live here and in
`input-monitoring-ownership.md`.

## Standing probes

1. **The gesture nobody walked (#3073).** Enumerate the gestures from the module's own control surface (the use-case
   directory, `transportControls/`), never from the diff: the diff shows what the author thought about, the directory
   what the user can press. #3073 wired native session start and stop into `startPlayback`/`stopPlayback`; review
   attacked play/stop/play re-entry, replaced topology and a stop overtaking its start, but never opened pause, so the
   native transport kept `is_playing: true` with its clock advancing under a paused UI. List play, pause, resume, stop,
   stop-after-pause, seek while playing, seek while stopped, record and loop toggle; for each, one line naming what
   the runtime is left holding and whether it contradicts what the UI claims. A gesture with no answer is the
   finding. Walk pairs too: gesture then gesture in one round trip, a second arriving while the first is in flight,
   and a gesture that is a no-op alone but changes what the next one means. An unawaited lifecycle call is ordered by
   the queue the runtime serialises on: name it and say which command wins ("fire and forget" is a claim about
   failure handling, never ordering). A lifecycle gated off today (capability flag, empty topology, declining build)
   still gets the full walk; the gate is a schedule, not a contract.
2. **Unmount is a Connect gesture (#3226).** #3226 put a 15 s probe between opening a credential session and
   `replace_runtime`. Overlap looked unreachable because `configurationPending` disables the button, but `AiSection`
   unmounts when Preferences leaves AI (`section === 'ai' ? <AiSection /> : null`), which drops the flag, so a second
   Connect starts while the first probe is alive and the first then overwrites the second. A pending flag on a
   conditionally mounted surface is not a lifecycle lock. For any change that puts a network or IPC wait between
   opening a session and installing it, walk Connect, leave the section and return, Connect again before the first
   wait settles, and name which runtime is installed; the first one is the finding.
3. **A hydrate has two callers with opposite contracts (#171).** `transportStore.fromCrdt` expands the partial
   document slot from defaults and its spec expected cached `isPlaying`, `isRecording` and `playheadPosition` dropped;
   the adapter merge `{ ...localValue, ...authorityValue }` then overwrote those runtime keys on every projection
   that was not a project load, so a collaborator's tempo edit, or any remote change after a local transport edit,
   stopped playback and recording and left the take uncommitted (only `projectCommittedLocalState` restored them).
   A load starts every field from the document; a re-projection of the open project (sync, merge, branch switch)
   must leave fields the store never persists alone. Drive the real repository, `setupProjectionBridge`, the store
   and `replaceCrdtDocInLineage` with playing, recording and the playhead at a nonzero beat; apply a remote change to
   that store's own slot and one to an unrelated slot after a local edit; the runtime fields survive and the durable
   field takes the remote value. A spec that sets a runtime field and expects hydrate to drop it is the fingerprint:
   ask which caller it speaks for.
4. **Cold strip: live eligibility is not an initialized strip (#2035, #2083).** #2035 built runtime topology for
   every project device and #2083 excluded Yeast but left scheduler synth and drum devices in the Web Audio chain
   projection, so a MIDI track carries valid project instruments with no Web Audio node beside a node-backed effect;
   #2083 also made device edits require an exact live before-chain, and MIDI import publishes the track with its
   default Synth after boot's strip projection, so a lawful Remove Synth before first Play committed project truth
   and then failed against an absent strip (Play/Stop warming masked it). Drive the real import, Command/CRDT/history
   and engine boundary with a completed import, an actually absent strip and no Play gesture, and a cold plus an
   already initialized strip holding a MIDI synth or drum and an effect: real add, Undo and Redo keep project and
   native snapshots at the complete instrument and effect identities while Web Audio initializes or reconciles only
   node-backed members; an instrument-only edit preserves full native truth; Undo changes the existing live chain
   instead of sending an initialization snapshot only a matching strip accepts. Cover cold add/remove/reorder and
   grouped final-chain composition. Controls that must still refuse: unknown device types (visible for ordinary
   construction refusal), an existing mismatched strip, stale or unrelated project divergence, duplicate ownership;
   inject initialization rejection and require committed failure with no later parameter writes. Remove the
   projection or the missing-strip admission and the cold Command regression must fail. The UI case requires the
   Remove Synth control unconditionally and clicks it before first Play.
5. **A start that steps over queued material (#4020 and its repair).** #4020 aimed the native roll at the position
   Web Audio had reached during the session's own start-up (75-88 ms after the click). The MIDI arm had queued the
   note pass from the parked position and the engine scans its store from block start, so every note-on in the
   skipped window was never delivered: a downbeat chord on a native-hosted instrument stayed silent for its whole
   length. The header's "Web Audio sounded that stretch" and "the engine counts those late" were untraced and false:
   the carried strip's Web Audio gate is pinned to zero 50 ms after the claim, a native-hosted instrument has no Web
   Audio voice, and the late counter runs at store time against the parked playhead. For any start, resume or re-arm
   that moves where the runtime begins relative to the position its arms and topology were built for, name the
   material stamped in the difference and trace on head the store's delivery bound
   (`partition_point(|entry| entry.at_frame < block_start)` in `enqueue_due_midi_notes`) against the arm's stamps, and
   the other carrier's gate ramp and voice presence (`TrackNode.setNativeCarried`, `CARRIER_GATE_LANDING_SEC`).
   Material nothing delivers is the finding; "the other carrier covers it" without both traces is discarded. Caller
   half: the repair deleted the roll projection from the shared session start, not from the one caller it was wrong
   for. Holding the Web Audio start removes the need for projection, and only `startPlayback` can hold; the mid-play
   re-arm joins a transport sounding for seconds and cannot, so removing the correction for both leaves the re-armed
   engine rolling at the beat read before its own start round trips and that far behind Web Audio for the rest of the
   play, the position feed pulling the cursor back. When a change removes a correction from a shared start, run
   `grep -rn startNativeSessionAtBeat src/modules --include='*.ts' | grep -v __tests__`, read each caller and name
   what stands in for the correction there; "the shared path handles it" needs a path that tells callers apart.
6. **Roll position consumed after a later await (#5453).** #5453 added `material.prepare` to every native backend
   apply. The live session computes its rolling join position before `rollNativeTransport`, whose second
   `backend.apply` awaits material owner/lease preparation before `set-transport` reaches native IPC, so the first
   topology apply's clock projection does not cover the roll apply's awaits (the gap is also in the no-NAM source
   path; only the NAM RED case was observed, never a no-NAM runtime failure). Hold roll material preparation after
   maps and MIDI are armed, advance the anchored Web Audio clock from 10 to 10.4, and require the sent position to
   refresh from 2.5 to 2.9 after every pre-IPC await. For NAM keep Web Audio sounding through model readback and all
   material/bank awaits, validate and claim the matching admission, then close the actual rebound strip gate in the
   same turn that builds the refreshed command immediately before roll IPC; do not wait for the roll reply to gate.
   Hosted evidence (Alpha run 40258854873, Unit 1 job 121366976610): actual-model-drain cases failed at `maps` and
   `roll-material` because the NAM strip was claimed while those checkpoints were held; `roll-admission` was the
   passing positive control. The public #5453 review had four draws (lease generation, admission capacity, callback
   retirement, project repair preservation) and no clock-handoff draw.
7. **A deferred seek finalizes into a successor transport (#305, #5374).** #305 moved seek finalization behind the
   recording-flush promise holding only the pre-wait `wasPlaying` snapshot; during the wait Stop then Play or Stop
   then Record installs a successor scheduler that the old finalizer stops, overwrites with its stale seek target or
   restarts against. Checking live `isPlaying` gates restart only; it is not ownership. Through the real
   seek/transport coordinator, hold the controlled promise at the `stopActiveRecording` boundary after a playing,
   recording seek is admitted; while held run Stop then Play and Stop then Record; then resolve and reject it.
   Successor worker identity, generation, epoch, transport state and position stay intact, and on rejection the
   original error is still reported. Removing the scheduler-generation ownership check (#5374) must fail both
   successor cases.
8. **Paused punch ownership outlives its roll (#305, #5272).** #305 fenced asynchronous pause teardown but did not
   retire the old punch owner when Play arrived during recorder flush. Drive real Pause and Play with a held recorder
   terminal, a recorder fake keeping the repository's same-track admission (a start behind a flushing session waits
   for it and is refused after any later stop), and production Command/CRDT: Pause, seek before the punch-in, Play,
   then either release the old flush before a later tick punches in, or punch in on that tick and release the flush
   while the successor's start waits. The successor flag, clip and scheduler survive the late pause continuation;
   each completed capture owns its PCM, saved take and one history entry; Undo/Redo preserve the peer. Mutations:
   removing synchronous punch retirement stops the successor punching in; clearing the flag from, or dropping the
   `isPlaying` guard of, the late pause continuation fails both orderings; admitting the start at once, or resolving
   the old terminal's clip from `activeRecordingRef`, fails the waiting one. Both orderings are proved in
   `punchPausePlayCommand.integration.spec.ts` (first-window punch Play waiting for the closing take; refused start
   behind a held flush), which #5998 and #5999 had blocked.
9. **Settlement needs the current attempt, root and incarnation.** A continuation admitted by track ID, device ID or
   reused project timestamp alone can publish into a successor. Hold the continuation and replace what it belongs to:
    - Failed Freeze settlement (#2597): the failure settlement after the render refuses must still belong to the exact
      project root, revision, task and freeze aggregate when admitted and immediately before commit, and an old
      attempt must not clear a newer task in its finalizer. Hold settlement admission and, separately, its staged-write
      commit boundary; cancel, start a newer task, replace the root with the same timestamp and track ID,
      remove/recreate the track, or replace its take: the successor survives with no failed-Freeze history. Pair each
      refusal with a genuinely current retry that persists its reason and later freezes, undoes and redoes normally.
      Drive the real Command/durable-state route, never a direct use-case callback.
    - Crumbs waveform work (#5041, #5780): hold telemetry and peaks through the app-injected owner reader; replace an
      identical-ID root, and remove/restore the same device object while its preceding view is still present. Observe
      every committed owner transition before coalescing reconciliation so absence/type/owner/duplicate ABA cannot
      revive an old token. Do not start a newer load or replace the sample leaf before the refusal assertion (those
      guards hide a missing fence). Real ordinary parameter writes and fresh successor loads stay controls. Remove the
      synchronous owner refresh and the unchanged ABA case must fail. This proves display authority only.
    - Elastic (`33a3549990c5`): change sensitivity on varied-pulse audio, await the actual detection and owner
      projection, and require count, drawing and marker hit-testing to update without a pointer refresh; switch clips
      and check the current clip's projection, retained lock, an unrelated clip and PCM. A subscription rollback must
      fail the real-store case (no Worker or performance claim). The initial target mismatch was hidden by explicitly
      opening every sensitivity fixture. Hold the real debounce across selection A, B, A, explicit editor close/reopen,
      source replacement and same-ID root replacement: the old gesture leaves native rows and PCM exact, settles its
      callers and releases listeners; only a fresh gesture may act on the new owner; an unrelated selection must not
      override an explicitly opened target. Removing pending-owner invalidation must fail real raw-state controls,
      not a cancellation flag.
10. **Recording closure outlives its root (#5517, #5289).** Neither user Stop nor automatic punch-out captured the
    installed root when the take opened (`0249a95cc5292`, async MIDI commit and failure-discard in #4564), and a
    capture-terminal guard does not cover those Stop routes. Drive both with a real captured-root identity. Replace
    the root before entry and independently while the real commit is held: the owning staged result is preserved,
    successor writes and cleanup are rejected, the branch-move warning fires. Spy directly on `trackTakeCommit`:
    neither refused entry may register even if downstream outcome filtering hides the error; remove each caller's
    ownership conjunct separately and its own spy assertion must fail. Clear refs and finalize again: no second
    gesture counts. Controls: a genuine closure, a legacy null witness, a landed sibling beside a refused sibling.
    Capture authority before clearing refs, retain it across every queued wait, and tell refused resume from success
    that settled just before replacement. Audio terminal (#4270, #4564, #5373): capture the public root identity at
    each punch opening before callback registration and retain it through success, failure, commit wait and catch;
    guard before caching media, reading a same-ID live clip or discarding it. Replace the root with copied
    provisional state while an audio capture is open, settle stale success and stale failure, then reject a held
    commit after replacement: the successor stays exact and no notice falsely claims it discarded the take. On the
    same root real success commits once and genuine failure retires its own provisional state. Open a later punch on
    the replacement root while the prior callback is pending; only the later terminal attaches media and history;
    separate armed-input callbacks stay. A settled capture promise's lifecycle count never proves a landed take.
    Manual Stop (#5289, missing-clip append escape): hold the recorder terminal; a real switch stays on the outgoing
    root until its take and Command entry settle, then saves that branch and clears incoming Undo; a real fork
    installs its copied root while the old flush is held and both old success and old failure preserve the
    successor's same-ID provisional clip, takes, media and history. Pair same-owner completion and failure, known PCM
    through the real cache and real Undo/Redo. Make the captured-root predicate always true and both stale-terminal
    cases must fail.
11. **A new refusal outcome leaves each caller's provisional writes behind (#5999).** `c8f18d184c` made
    `startAudioRecording` resolve `false` when a stop moves `startGeneration` during a same-track wait; the automatic
    punch-in admission in `startPlayheadScheduler.ts` removed only its capture clock, leaving the provisional clip
    and take with no audio and no history entry (repaired in #6010). When a repository gains a refusal outcome,
    enumerate every caller and what it wrote before awaiting; drive each through the refusal and require clip, take
    and history to equal the state before the start, quietly when a stop caused it. Repair-review second class: on
    Play's initial window the cleanup ran while the initial-playback programme witness (store-reference compare) was
    pending, so Play aborted "Playback changed while preparing", and on a loop seam the cleanup retired the pass
    timing the initial finalize needed. A cleanup write belongs after the preparation witnessing the stores it
    touches: defer it until no initial emission is preparing.
12. **An await inside a live preparation witness (#5998, #5729).** #5729 made Play's initial window await the
    punch-in recorder admission while the witness was live; the previous take's commit, and later a previous
    scheduler session's deferred cleanup, landed in the await and refused the Play (fixed in #6013: a first-window
    punch Play waits for the closing take, `opensPunchIn` shared with the scheduler; refused-start cleanup is held
    across scheduler sessions). For every await taken while a store-identity witness is live, list which gestures'
    writes can land in it; each is ordered before the witness or shown not to reach the compared stores. Pin both
    sides: the earlier take and the earlier session's cleanup landing mid-await must not refuse the Play; an
    unrelated genuine edit mid-await must. The non-punch Play with Yeast preparation remains open in #6012.
13. **A busy automation pump retained an edit without sending its successor (#5461).** #5461 observed a newer lane,
    VCA or solo projection while a native batch was in flight and returned; the predecessor's completion released its
    in-flight marker but arranged no follow-up, so the edit reached the backend only if a later playhead poll came
    (the existing real-store pending case settled the batch before asking for another pump). Hold an earlier backend
    apply after it captured a real-store batch; edit a lane, VCA or solo state and invoke one same-pass pump while it
    is unanswered: no overlap; then settle the predecessor without another pump and require one serialized successor
    carrying the new Hold or control with the unrelated queue untouched. Coalesce later matching snapshots; reject an
    old pass or backend after seek, disarm or replacement; keep refusal and batch-fence accounting. Removing only the
    completion follow-up must fail the case. It proves scheduled submission, not a wall-clock deadline while blocked.
14. **Dense loop-off inherits a linear window that replenishes after its frames (#3912, #5346).** #3912 admitted a
    capacity-sized linear prefix but kept its spent entries until more than three seconds in; a 1200-pair,
    three-second phrase filled the 2048-entry store and the remaining 352 events arrived only after their frames
    (#5346's loop-window work hit it by disabling looping near the start). Capacity-safe admission is not timely
    delivery. Walk dense loop-on to loop-off at the start and near-start, then seek and edit-rearm in the resulting
    linear mode. Drive the real writer against a persistent store and render through the entire phrase: every expected
    event identity arrives before its frame, residency is bounded, no callback overflows. Carry a distant real off
    and a same-key reattack through the transitions without replaying the old onset. Restoring the linear
    prefix/three-second-clear path must fail the suffix assertions. Model host queue admission separately from
    callback application: a later note-store refusal leaves preceding clears applied and cannot be retried from an
    already-applied host response. Native output peaks supplement; they cannot count all attacks/releases or prove
    zero callback refusals when the wire omits those counters.
15. **Shutdown reclamation needs a release inside the poll pass (#2976, #5064).** The native CI failure on #5064
    came after the stop and destroy assertions passed: the whole-cascade wall-clock assertion read 252.790917 ms
    against 250 ms, which names no cascade step. Pin the scheduler-release transition itself: keep an extra runtime
    owner through the first retirement sweep, release it inside the first 2 ms poll callback, and require the next
    sweep to destroy it before another wait. Independently hold the owner across a synthetic wait longer than the
    500 ms budget and require a retained, named abandonment with no second poll.
16. **Init fault announces a healthy engine (Levain, #5227).** `90bc7995e44e` added the buffered pre-init loop; #946
    gave live handlers bank-local rejection while buffered replay escaped init's outer catch; #5587 repaired
    bank-local replay but a failed engine creation could still post `ready` on a later init while retaining its
    terminal fault, and no case counted a repeated `disposed` reply. Drive the raw port through a failed init,
    another init, a bank start and a release: the original error each time, no engine creation, replay or healthy
    ready, no rendered block. A fresh processor's successful init and bank-local replay still work. Dispose the same
    processor twice: two replies and a completed paced drain. Refusing a second init must not alter the shipped
    node's first-init readiness or the owner/follower bank lifecycle. Remove the terminal init refusal and the
    repeated-dispose answer separately; each unchanged named regression must fail.
17. **Unsupported NAM replacement must preserve the sounding model (#5209).** #5209 introduced the real NAM runtime
    with an admitted stacked-wide LSTM shape whose deeper input width contradicts its render buffer. Activate Capture
    mode and advance two identical loaded engines with identical input; attempt the unsupported replacement on one
    only; its subsequent PCM must equal the continuing reference with no reset, and be nonzero and separated from a
    matched unloaded/dry control (`has_loaded_neural_model` plus finite output passes while Circuit mode bypasses the
    capture). Pair empty-engine refusal with both supported topology boundaries and keep the selected library entry
    at the real import UI. Proves the shared/WASM route, not native transport or physical playback.
18. **Cached preview sources outlive their engine graph (`454de02a76`, #187).** Stop stopped the UI-owned preview
    source and natural completion cleared UI state, with no disconnect or engine-lifetime cleanup; #187 moved it into
    AudioEngine's cached preview helper. Start a cached preview through its real owner, then reset or dispose the
    engine: the source stops and disconnects before the outgoing graph retires, one completion notification, no
    admission against the outgoing lifetime. Start a successor during an old callback and deliver the old completion
    and release afterward; the successor survives. Pair nested reset, cleanup failure and disposed-engine refusal
    with ordinary previews that still coexist. Removing reset invalidation or the disposed-owner guard must fail
    those cases. Intent currentness permits preparation only; native monitoring readiness, programme isolation and
    audible A/B need their own evidence.
19. **Cold frozen export restoration must finish before rendering.** The clip-only restoration set from
    `57b7349f7864` survived owner-use-case routing in `ab5a579209b5` (#187). Input: a fresh runtime whose active
    frozen print is durable but absent from memory, beside an ordinary clip. Hold restoration: no render or encode;
    release it through the real cache owner: active frozen PCM appears in both mixdown and stems. Remove only its
    requested ID: failure before encoding. Preserve stale-print exclusion, the empty-clip fallback, cancellation and
    the dialog session fence (a late older callback must not paint a reopened dialog).
20. **VCA membership must reach committed runtime gain (`22a84b216658`, #1049).** The Inspector's direct calls
    bypassed the committed gain continuation. Drive Create, Assign and None through the mounted gesture, real
    Command, handler and reconciler. At the engine caller raw CRDT and projection agree and composed static or
    automated gain at the selected beat is observed through the gesture, Undo and Redo. Seed a non-unity group and an
    automated peer; check the scheduled value, no duplicate subject scheduling, unrelated tracks preserved. Reverting
    the matching component dispatch must fail its history and gain case. Queued gesture (caught in #5789 review):
    a gesture waiting for a root snapshot must not reach a same-ID successor root, while an ordinary snapshot on the
    same project still lets it through; hold and release the real queue around production root replacement and
    inspect successor state, history and engine calls.
21. **Live cancellation is not durable cancellation (#1949, `ce2ffea3fd`).** Pending-confirmation cancellation
    revoked its run before cleanup, but its already-terminal retry trusted live state after local persistence
    failed. Inject a real `Storage.setItem` failure during cancellation; the live run is terminal while the saved run
    is unchanged; cancel the same confirmation again. The retry must persist that exact run before releasing
    temporary run assets or confirmation resources, and must not report success while cleanup is pending. Repeat
    without temporary assets: an already-terminal no-op cannot prove persistence. A mocked cancellation helper misses
    the live-store-before-storage seam.

## Collaboration teardown and receive-side sync

Moved from the `crdt-collaboration` skill.

22. **Teardown and callbacks stay bound to their installed runtime.** A buffered leave-message drain followed by
    global session cleanup after an await closed whichever session was installed by then, and stale join
    continuations were invalidated without binding cleanup to the runtime that began it. Pause an outgoing leave at
    its transport await, install a successor session: the outgoing cleanup cannot close or reset the successor. Retain
    old manager, sync, asset, timer, branch-transition and decode callbacks and invoke or settle them after
    replacement: they neither read successor state nor write project, runtime or panel state, while current-owner
    callbacks stay effective.
23. **Teardown durability through the registered actions.** Drive the registered create, join and leave actions
    through both `executeAppAction` and singleton `executeAppActionBatch`. Hold and reject the underlying lifecycle
    promise: command completion waits for it, and the runtime route never opens a project storage transaction.
    Exercise no-op root persistence, changed-root persistence and handoff, and generic document persistence, since
    each route can swallow its own error before a drain-only tail sees it. Include a repository commit followed by an
    exact-head rejection, partial session initialization, and a second explicit lifecycle attempt retrying the
    retained work after the installed owner was cleared. A successful promise tail, a committed write without fresh
    exact authority, or a configuration-object assertion is not durable teardown.
24. **A staged session backup survives repeated removal failure (#1581).** Non-throwing local-storage writes advanced
    their cache after failure. Reject repeated removal failures until a fresh durable read proves the backup gone;
    write newer branch state while removal stays refused: retry does not replay the stale backup and a later
    successful removal settles it. Refuse both backup and branch-state reads after initialization: recovery keeps the
    earliest durable witness; a failed `trySet` notification cannot authorize deletion, while a directly observed
    successful adapter write protects the newer branch state even if reads stay blocked.
25. **A prepared asset-handoff commit queues behind accepted owner operations (#4248).** Prepared commit closures
    bypassed the durable owner operation queue. Prepare the handoff, admit and hold a source staging operation, then
    invoke the returned commit: it reaches no owner repository until the accepted operation settles, and both
    results stay recoverable from fresh repository instances.
26. **Receive-side sync progress is real, fenced transport work.** Suppressing repository change notifications while
    applying a remote document left no protocol reply or fan-out at the accepted receive boundary. Fixtures that
    fabricated a local change notification after every receive, or hid empty rounds behind three deliveries, masked
    it: treat the first change as the defect. Use isolated production endpoints, actual transport messages and one
    shared initialized genesis before separate offline edits; settle each send before delivering its response so the
    sender records the generated SyncState first, and prove a sanitizer sees an edit-bearing payload before asserting
    rollback. Fixed delivery counts are never convergence proof. After a successful accepted receive, the reply to its
    connected source and the changed-content fan-out use the existing per-peer queue, deferred only behind completed
    owner and persistence work, with scheduling and queued execution both fenced against stop or source disconnect.
    A stopped or disconnected runtime never revives a queue, while a live host still relays accepted content to its
    other connected peers.
27. **Worker-ready recording admission reaches the real first-frame seam.** Capture started from a worker-ready
    continuation while the command already returned success before the worklet captured input. Hold worker readiness
    through the real recorder-to-transport route and drive the first nonempty processor block at a known
    `AudioWorkletGlobalScope.currentFrame`. No successful-start observable and no uncaptured transport interval may
    exist before the actual sample-zero receipt, and exactly one start follows it. A returned boolean, the
    worker-ready message, main-thread callback time or a pre-resolved recorder mock cannot establish capture-clock
    alignment; resolving the start on worker readiness must fail the case.

## Recording rings, stop fence and artifact identity

Moved from the `web-audio-engine` skill. A pre-copy cursor check can admit mixed PCM, a signed or low-word rollover
can make a full ring turn look empty, and clearing the stop deadline on the producer acknowledgment lets a stalled
final drain retain the input session indefinitely.

28. **Ring publication.** Drive real 128-frame writes across signed and unsigned word rollover, at capacity minus
    one, exact and plus one, and with a writer paused inside the consumer copy. The worker copies only an interval
    bracketed by the same stable sequence and cumulative count, retries an in-progress or changed copy, and abandons a
    lapped interval rather than write substituted PCM. Publishing a signed 32-bit cursor as the history contract, or
    the count before the odd sequence, must fail a case.
29. **Stop fence.** Accept only the captured session's producer-stop acknowledgment, make one final worker drain
    against that count, and keep the original flush deadline armed through acknowledgment. A missing acknowledgment or
    flush cleans that exact captured session without touching a successor for the same track; clearing the deadline
    on acknowledgment must fail.
30. **Artifact identity.** Recording artifacts need identity independent of wall-clock time: one cryptographically
    unique temp-file name generated at worker initialization. Run two isolated workers sharing a filename-keyed
    staged OPFS at one timestamp: each delivered WAV retains its own PCM, and removing one staging entry does not
    remove the other's.

## Relocated

- Editor WebSocket loss vs acceptance document lifetime, entry recovery that must not navigate a running document
  (#5595), and first paint concealing started bootstrap effects (#3356): `startup-entry-availability.md`.
- Input-monitoring and capture-ownership lessons (keyed acquisition #4394/#4423, refused Off, track removal, #5011,
  disconnect faults #4485/#5376, held-removal owners #5283, Undo restoration and every #5091 head): see
  `input-monitoring-ownership.md`.

## Retired lessons

- Early scheduler callbacks publishing future deadlines (#955) -> enforced by
  `src/modules/Transport/workers/__tests__/schedulerWorker.spec.ts` "keeps early callbacks $phase from publishing
  future deadlines" (both phases: before the first deadline, and after missed slots). Controls in the same file:
  "starts an interval that posts a tick every `interval` ms", "reports missed timer slots without carrying a stall
  into later wake-lateness measurements", "clears the previous interval and restarts when start arrives twice" and
  "stops posting ticks after a stop message". Receiver guards in
  `useCases/playheadScheduler/__tests__/startPlayheadScheduler.spec.ts` "ignores non-tick and malformed tick worker
  messages" and "ignores a queued tick from a retired scheduler generation".
