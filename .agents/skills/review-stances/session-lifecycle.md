# Standing probes: runtime session lifecycle

Defects where a transport-side runtime (the native live graph session, the playhead scheduler and feed, the
automation pump, browser MIDI access, and the take a recording opens and closes around them) is started, stopped,
parked, replaced or disposed while a gesture, continuation or captured owner still acts for another lifetime.
Controlled ports (media, graph, scheduler, wall-clock) prove ordering, ownership and cleanup; they never establish
physical hardware audibility.

Split out by defect class (a stance matching one carries that file, not this one): strip, device, engine and
settlement lifetimes in `runtime-instance-lifetimes.md`; collaboration teardown and receive-side sync in
`collaboration-teardown.md`; input capture, monitor owners, recording first frame, rings, stop fence and artifact
identity in `input-monitoring-ownership.md`.

## Standing probes

1. **The gesture nobody walked (#3073).** Enumerate gestures from the module's own control surface
   (`src/modules/Transport/useCases/transportControls/`), never from the diff: #3073 wired native session start and
   stop into `startPlayback`/`stopPlayback` but nobody opened pause, so the native transport kept `is_playing: true`
   with its clock advancing under a paused UI. List play, pause, resume, stop, stop-after-pause, seek while playing,
   seek while stopped, record and loop toggle; for each, name what the runtime is left holding and whether it
   contradicts the UI. A gesture with no answer is the finding. Walk pairs too: gesture then gesture in one round
   trip, a second arriving while the first is in flight, and a no-op that changes what the next gesture means. An
   unawaited lifecycle call is ordered by the queue the runtime serialises on: name it and say which command wins. A
   lifecycle gated off today (capability flag, empty topology, declining build) still gets the full walk.
2. **A hydrate has two callers with opposite contracts (#171).** `transportStore.fromCrdt` expanded the partial
   document slot from defaults, and the adapter merge then overwrote cached `isPlaying`, `isRecording` and
   `playheadPosition` on every re-projection, so a collaborator's tempo edit stopped playback and recording and left
   the take uncommitted. A load starts every field from the document; a re-projection of the open project (sync,
   merge, branch switch) leaves fields the store never persists alone. Drive the real repository,
   `setupProjectionBridge`, the store and `replaceCrdtDocInLineage` while playing, recording and at a nonzero beat;
   apply a remote change to that store's slot and one to an unrelated slot after a local edit: runtime fields survive
   and the durable field takes the remote value. A spec expecting hydrate to drop a runtime field is the fingerprint.
3. **A start that steps over queued material (#4020).** Aiming the native roll at the position Web Audio reached
   during start-up skipped every note-on stamped in that window: a downbeat chord on a native-hosted instrument
   stayed silent. For any start, resume or re-arm that moves where the runtime begins relative to the position its
   arms were built for, name the material stamped in the difference and trace on head the store's delivery bound
   (`partition_point(|entry| entry.at_frame < block_start)` in `enqueue_due_midi_notes`) against the arm's stamps,
   and the other carrier's gate ramp and voice presence (`TrackNode.setNativeCarried`, `CARRIER_GATE_LANDING_SEC`).
   Material nothing delivers is the finding; "the other carrier covers it" without both traces is discarded. Caller
   half: only `startPlayback` can hold its Web Audio start; the mid-play re-arm cannot, so removing a correction from
   the shared start leaves the re-armed engine behind Web Audio for the rest of the play. When a change removes a
   correction from a shared start, run `grep -rn startNativeSessionAtBeat src/modules --include='*.ts' | grep -v
__tests__`, read each caller and name what stands in for the correction there.
4. **Roll position consumed after a later await (#5453).** The live session computes its join position before
   `rollNativeTransport`, whose second `backend.apply` awaits `material.prepare` before `set-transport` reaches native
   IPC, so the sent position is stale by every pre-IPC await (NAM and no-NAM source paths alike). Hold roll material
   preparation after maps and MIDI are armed, advance the anchored Web Audio clock from 10 to 10.4, and require the
   sent position to refresh from 2.5 to 2.9 after every pre-IPC await. For NAM keep Web Audio sounding through model
   readback and all material and bank awaits, validate and claim the matching admission, then close the rebound strip
   gate in the same turn that builds the refreshed command immediately before roll IPC; claiming the strip while
   `maps` or `roll-material` is held must fail, with `roll-admission` held as the passing positive control.
5. **A deferred seek finalizes into a successor transport (#305, #5374).** Seek finalization behind the
   recording-flush promise held only the pre-wait `wasPlaying` snapshot, so Stop then Play (or Record) during the wait
   installed a successor the old finalizer stopped, overwrote or restarted. Live `isPlaying` gates restart only; it is
   not ownership. Through the real seek/transport coordinator, hold the promise at the `stopActiveRecording` boundary
   after a playing, recording seek is admitted; run Stop then Play and Stop then Record; resolve and reject it.
   Successor worker identity, generation, epoch, state and position stay intact, and rejection still reports the
   original error. Removing the scheduler-generation ownership check must fail both successor cases.
6. **Paused punch ownership outlives its roll (#305, #5272).** Drive real Pause and Play with a held recorder
   terminal, a recorder fake keeping the repository's same-track admission (a start behind a flushing session waits
   and is refused after any later stop), and production Command/CRDT: Pause, seek before the punch-in, Play, then
   either release the old flush before a later tick punches in, or punch in on that tick and release the flush while
   the successor's start waits. The successor flag, clip and scheduler survive the late pause continuation; each
   capture owns its PCM, take and one history entry; Undo/Redo preserve the peer. Mutations: removing synchronous
   punch retirement stops the successor punching in; clearing the flag from, or dropping the `isPlaying` guard of, the
   late continuation fails both orderings; admitting the start at once, or resolving the old terminal's clip from
   `activeRecordingRef`, fails the waiting one. Spec:
   `src/modules/Transport/useCases/playheadScheduler/__tests__/punchPausePlayCommand.integration.spec.ts`.
7. **Recording closure outlives its root (#5517, #5289, #4564, #4270, #5373).** User Stop and automatic punch-out
   must capture the installed root when the take opens; a capture-terminal guard does not cover those Stop routes.
   Drive both with a real captured-root identity; replace the root before entry and again while the real commit is
   held: the owning staged result is preserved, successor writes and cleanup are rejected, the branch-move warning
   fires. Spy on `trackTakeCommit`: neither refused entry registers even if outcome filtering hides the error; remove
   each caller's ownership conjunct separately and its own spy assertion must fail. Clear refs and finalize again: no
   second gesture counts. Controls: a genuine closure, a legacy null witness, and a sibling landed before the root
   replacement beside one refused after it (landed entry plus exactly one settled gesture kept); removing
   dispatch-option forwarding fails that case. Audio terminal: capture the root at each punch opening before callback
   registration and retain it through success, failure, commit wait and catch; guard before caching media, reading a
   same-ID live clip or discarding it. Replace the root with copied provisional state while a capture is open, settle
   stale success and stale failure, reject a held commit after replacement: the successor stays exact and no notice
   claims it discarded the take; only a later punch on the replacement root attaches media and history. Manual Stop
   (#5289): a real switch stays on the outgoing root until its take and Command entry settle; a real fork installs its
   copied root while the old flush is held and both old outcomes preserve the successor's same-ID clip, takes, media
   and history. Settled capture promises keep Transport's lifecycle count semantics, and that count never proves a
   landed take. Making the captured-root predicate always true must fail both stale-terminal cases.
8. **A refusal cleanup or an earlier write lands inside a live preparation witness (#5999, #6010, #5729, #5998,
   #6013, #6012, #6037).** `startAudioRecording` resolving `false` when a stop moves `startGeneration` during a
   same-track wait left the automatic punch-in's provisional clip and take with no audio and no history. When a
   repository gains a refusal outcome, enumerate every caller and what it wrote before awaiting; drive each through
   the refusal and require clip, take and history to equal the state before the start, quietly when a stop caused it.
   Play's initial window awaits punch-in admission while a store-identity witness is live: for every such await, list
   which gestures' writes can land in it (refused-start cleanup, the previous take's commit, a previous scheduler
   session's deferred cleanup, loop-seam pass retirement) and require each ordered before the witness or shown not to
   reach the compared stores. Pin both sides: those writes and a non-punch Play with Yeast tracks preparing during a
   held flush must not refuse Play ("Playback changed while preparing"); an unrelated genuine edit mid-await must.
   Refusing on any store-reference change rather than on changed prepared inputs fails the Yeast case.
9. **Device automation ownership survives ordinary project edits (#1648, #3847).** A driving-receipt reset keyed on
   the track-store object changing retired ownership on every immutable edit, so Off emitted no saved-base
   restoration; a fixture mutating a nested `automationMode` in place missed it. Drive a parameter, publish Off through
   the real public setter, and require one restoration of the latest persisted manual base (a peer or typed manual
   base edit included) with no project or manual-history change; first prove live Command, history, active macro
   recording and Undo/Redo on a real manual edit, taking the post-Redo baseline (manual Redo records the forward
   macro action again). Ownership follows the installed root and scheduler lifetime, not a projection reference:
   immutable track edits, ancillary child membership, same-lineage peer merge and rollback keep it; a same-ID,
   same-content root reinstall and a same-root scheduler teardown and restart (including across null or empty
   automation observations) reuse no outgoing driving or bypass receipt. A loop or follow discontinuity within one
   live generation keeps ownership while snapping stale slew. Durable IDs and equal bytes do not establish runtime
   ownership; reverting to the store-reference reset must fail the Off case.
10. **A busy automation pump retains an edit without sending its successor (#5461).** Hold an earlier backend apply
    after it captured a real-store batch; edit a lane, VCA or solo state and invoke one same-pass pump while it is
    unanswered: no overlap; settle the predecessor without another pump and require one serialized successor carrying
    the new Hold or control with the unrelated queue untouched. Coalesce later matching snapshots; reject an old pass
    or backend after seek, disarm or replacement; keep refusal and batch-fence accounting. Removing only the
    completion follow-up must fail. It proves scheduled submission, not a wall-clock deadline while blocked.
11. **Dense loop-off inherits a linear window that replenishes after its frames (#3912, #5346).** Capacity-safe
    admission is not timely delivery: a dense phrase with more events than the native note store holds, admitted as a
    capacity-sized linear prefix whose spent entries are cleared late, delivers its tail after the frames it was due.
    Walk dense loop-on to loop-off at the start and near-start, then seek and edit-rearm in the resulting linear mode.
    Drive the real writer against a persistent store through the whole phrase: every expected event identity arrives
    before its frame, residency is bounded, no callback overflows. Carry a distant real off and a same-key reattack
    through the transitions without replaying the old onset. Restoring the late-clear linear prefix must fail the
    suffix assertions. A later note-store refusal leaves preceding clears applied and cannot be retried from an
    already-applied host response. Native output peaks cannot count attacks or prove zero callback refusals.
12. **An admitted punch keeps its original ending (#4564, #4897, #5891).** Edit markers or loop after admission:
    require the same first qualifying original out, not its opening seam tick or an extra lap. An out at 14 beyond a
    loop 8..12 is an admitted open take: real MIDI through wraps and manual Stop survives; later authorized geometry
    first reaches the original 14, and marker edits cannot retarget it. Pending or future start and native
    unavailability still exclude input. Pair browser scheduling with a deliberately different native input cursor:
    onset, out exclusion, held or late release and Stop use one accepted carrier and pass. Refused audio recovery
    cannot certify surviving unsounded MIDI; hold native before out while browser time passes, require waiting, then
    sound it. Provider, root and original raw target incarnations decide debt; a removed, recreated or freshly armed
    target cannot inherit it. Early manual Stop uses the accepted position, not the future out. Removing frozen
    ownership or the accepted MIDI ending must fail. Producer PCM: `input-monitoring-ownership.md` probe 14; tempo and
    media law: `audio-timing-format-laws.md` probes 1 and 12.
13. **Sibling terminals publish one contiguous recording gesture (#4564).** Hold real audio while MIDI submits,
    interleave a foreign color edit, then require one Undo to remove every new clip, row and take but preserve color,
    the next Undo the color, and reverse Redo order. Group ID alone cannot join noncontiguous history. Pair failed,
    missing and unstarted inputs and full muted recovery with a valid sibling. Production serialization and both past
    and future hydration must preserve the group (`replay-authority.md` probe 7).
14. **Pending controller consumption waits for publication (#5338).** Fail or cancel a real second child after the
    first CRDT controller writes: raw and history roll back and the exact runtime owner survives. Describe and execute
    share one current-buffer plan, including the delayed-overdub closing lift; publication consumes only that prefix.
    The later suffix survives root, buffer, carry and seed replacement and, if already stopped, lands through the
    serialized overdub after primary history. A published observer failure keeps data and ambiguity, never discard,
    retry or a confirmed-history claim. Moving consumption back before commit must fail these controls.
15. **A pending browser MIDI access request outlives teardown or never completes (#5411).** Hold a real pending
    access request across picker teardown, then resolve and reject it: no old input, listener, callback or state
    returns, and a new current initialization stays a positive control. After permission is granted with zero
    devices, Refresh completes and shows the empty-device state, not indefinite detection; a later enumeration shows
    the device. Revert each completion or teardown guard and its named case must fail. The denial-versus-capability
    half lives in `security-and-platform.md` ("MIDI API present but permission refused").

## Retired lessons

- Early scheduler callbacks publishing future deadlines (#955) -> enforced by
  `src/modules/Transport/workers/__tests__/schedulerWorker.spec.ts` "keeps early callbacks $phase from publishing
  future deadlines", with receiver guards in
  `src/modules/Transport/useCases/playheadScheduler/__tests__/startPlayheadScheduler.spec.ts` "ignores non-tick and
  malformed tick worker messages" and "ignores a queued tick from a retired scheduler generation".

## Relocated

- Editor WebSocket loss vs acceptance document lifetime, entry recovery that must not navigate a running document
  (#5595), and first paint concealing started bootstrap effects (#3356): `startup-entry-availability.md` probes 1, 3
  and 7.
- Input-monitoring and capture-ownership lessons (keyed acquisition #4394/#4423, refused Off, track removal, #5011,
  disconnect faults #4485/#5376, held-removal owners #5283, Undo restoration and grants under #5091):
  `input-monitoring-ownership.md` probes 1 to 9.
- Optimistic removal retiring active recording input: `input-monitoring-ownership.md` probe 15.
