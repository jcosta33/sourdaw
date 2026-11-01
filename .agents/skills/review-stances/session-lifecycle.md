# Standing probes: runtime session lifecycle

Defects in anything that starts, stops, parks, replaces or disposes a long-lived runtime the app holds on behalf of
a user-facing mode: the native live graph session, the playhead scheduler and feed, a recording session, the
input-monitoring capture, a plugin host instance, a collaboration transport. A lifecycle stance carries this file.
Each probe names the failure mode, the input or state to drive and the check that must go red, and names the
mutation that must fail it where its source lesson established one. Controlled ports (media, graph, scheduler,
wall-clock) prove ordering, ownership and cleanup; they never establish physical hardware audibility. Runtime-monitor
companions to `project-integrity.md` live here and in `input-monitoring-ownership.md`.

Scope here: transport start, stop, seek, punch and recording-take lifetimes. Split out by defect class (a stance
matching one carries that file, not this one): strip, device, engine and settlement lifetimes in
`runtime-instance-lifetimes.md`; collaboration teardown and receive-side sync in `collaboration-teardown.md`;
recording first frame, rings, stop fence and artifact identity in `recording-session-ownership.md`.

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
2. **A hydrate has two callers with opposite contracts (#171).** `transportStore.fromCrdt` expands the partial
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
3. **A start that steps over queued material (#4020 and its repair).** #4020 aimed the native roll at the position
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
4. **Roll position consumed after a later await (#5453).** #5453 added `material.prepare` to every native backend
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
5. **A deferred seek finalizes into a successor transport (#305, #5374).** #305 moved seek finalization behind the
   recording-flush promise holding only the pre-wait `wasPlaying` snapshot; during the wait Stop then Play or Stop
   then Record installs a successor scheduler that the old finalizer stops, overwrites with its stale seek target or
   restarts against. Checking live `isPlaying` gates restart only; it is not ownership. Through the real
   seek/transport coordinator, hold the controlled promise at the `stopActiveRecording` boundary after a playing,
   recording seek is admitted; while held run Stop then Play and Stop then Record; then resolve and reject it.
   Successor worker identity, generation, epoch, transport state and position stay intact, and on rejection the
   original error is still reported. Removing the scheduler-generation ownership check (#5374) must fail both
   successor cases.
6. **Paused punch ownership outlives its roll (#305, #5272).** #305 fenced asynchronous pause teardown but did not
   retire the old punch owner when Play arrived during recorder flush. Drive real Pause and Play with a held recorder
   terminal, a recorder fake keeping the repository's same-track admission (a start behind a flushing session waits
   for it and is refused after any later stop), and production Command/CRDT: Pause, seek before the punch-in, Play,
   then either release the old flush before a later tick punches in, or punch in on that tick and release the flush
   while the successor's start waits. The successor flag, clip and scheduler survive the late pause continuation;
   each completed capture owns its PCM, saved take and one history entry; Undo/Redo preserve the peer. Mutations:
   removing synchronous punch retirement stops the successor punching in; clearing the flag from, or dropping the
   `isPlaying` guard of, the late pause continuation fails both orderings; admitting the start at once, or resolving
   the old terminal's clip from `activeRecordingRef`, fails the waiting one. Both orderings are proved in
   `src/modules/Transport/useCases/playheadScheduler/__tests__/punchPausePlayCommand.integration.spec.ts`
   (first-window punch Play waiting for the closing take; refused start behind a held flush), which #5998 and #5999
   had blocked.
7. **Recording closure outlives its root (#5517, #5289).** Neither user Stop nor automatic punch-out captured the
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
   separate armed-input callbacks stay. Settled capture promises, including refusals, keep Transport's existing
   lifecycle count semantics, and that count alone never proves a landed take.
   Manual Stop (#5289, missing-clip append escape): hold the recorder terminal; a real switch stays on the outgoing
   root until its take and Command entry settle, then saves that branch and clears incoming Undo; a real fork
   installs its copied root while the old flush is held and both old success and old failure preserve the
   successor's same-ID provisional clip, takes, media and history. Pair same-owner completion and failure, known PCM
   through the real cache and real Undo/Redo. Make the captured-root predicate always true and both stale-terminal
   cases must fail.
8. **A new refusal outcome leaves each caller's provisional writes behind (#5999).** `c8f18d184c` made
   `startAudioRecording` resolve `false` when a stop moves `startGeneration` during a same-track wait; the automatic
   punch-in admission in `startPlayheadScheduler.ts` removed only its capture clock, leaving the provisional clip
   and take with no audio and no history entry (repaired in #6010). When a repository gains a refusal outcome,
   enumerate every caller and what it wrote before awaiting; drive each through the refusal and require clip, take
   and history to equal the state before the start, quietly when a stop caused it. Repair-review second class: on
   Play's initial window the cleanup ran while the initial-playback programme witness (store-reference compare) was
   pending, so Play aborted "Playback changed while preparing", and on a loop seam the cleanup retired the pass
   timing the initial finalize needed. A cleanup write belongs after the preparation witnessing the stores it
   touches: defer it until no initial emission is preparing.
9. **An await inside a live preparation witness (#5998, #5729).** #5729 made Play's initial window await the
   punch-in recorder admission while the witness was live; the previous take's commit, and later a previous
   scheduler session's deferred cleanup, landed in the await and refused the Play (fixed in #6013: a first-window
   punch Play waits for the closing take, `opensPunchIn` shared with the scheduler; refused-start cleanup is held
   across scheduler sessions). For every await taken while a store-identity witness is live, list which gestures'
   writes can land in it; each is ordered before the witness or shown not to reach the compared stores. Pin both
   sides: the earlier take and the earlier session's cleanup landing mid-await must not refuse the Play; an
   unrelated genuine edit mid-await must. The non-punch Play with Yeast preparation remains open in #6012.
10. **A busy automation pump retained an edit without sending its successor (#5461).** #5461 observed a newer lane,
    VCA or solo projection while a native batch was in flight and returned; the predecessor's completion released its
    in-flight marker but arranged no follow-up, so the edit reached the backend only if a later playhead poll came
    (the existing real-store pending case settled the batch before asking for another pump). Hold an earlier backend
    apply after it captured a real-store batch; edit a lane, VCA or solo state and invoke one same-pass pump while it
    is unanswered: no overlap; then settle the predecessor without another pump and require one serialized successor
    carrying the new Hold or control with the unrelated queue untouched. Coalesce later matching snapshots; reject an
    old pass or backend after seek, disarm or replacement; keep refusal and batch-fence accounting. Removing only the
    completion follow-up must fail the case. It proves scheduled submission, not a wall-clock deadline while blocked.
11. **Dense loop-off inherits a linear window that replenishes after its frames (#3912, #5346).** #3912 admitted a
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
