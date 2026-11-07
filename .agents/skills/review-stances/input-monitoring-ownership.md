# Standing probes: input capture, monitor, recording-session and recording-owner lifetimes

Defects where input capture, monitor edges and streams, or recording owners cross a commit, Undo, deletion, graph
repair or root replacement, and where a recording session's first frame, ring publication, stop fence or artifact
identity is decided by a signal that does not prove the captured audio (worker readiness, a cursor check, an
acknowledgment or the wall clock). Monitor edges and streams are owned per track and per input key, admitted through
grants that settle later, and released by track removal, Off, selector change, root replacement and graph reset.
Observe actual source edges and MediaStreamTrack stops at the monitor outputs, never forwarded identifiers or owner
keys alone; capability comes from Arrangement's `getTrackEligibility(...).acceptsMonitoring`, not a recorder-owned
kind list. Each probe names the input or state, the check that must go red and the mutation that must fail it.
Controlled media, graph, scheduler and wall-clock ports prove ordering, ownership and cleanup, never physical
hardware audibility. Runtime-session companions live in `session-lifecycle.md`.

## Standing probes

1. **Acquisition cache keyed by nothing (#4394, #4423).** The input-monitoring session stayed a singleton with one
   monitor source and one pending acquisition, and `startInputMonitoring(trackId, inputId)` returned an existing
   source without comparing the requested input, so two armed tracks on different devices both heard the first; the
   manual On entry points never passed the track's selection and opened the global/default capture. Two tracks
   requesting different inputs yield two acquisitions and two distinct sources, each track edge fed by its own
   source, and the manual enable path carries the track's own selection into the engine call. Restore the singleton
   reuse (attach to whatever exists, ignore the key) and the assertion reddens. Ownership half: a per-track edge and
   a per-key stream are released exactly once; one key's failed acquisition does not disturb another key's source,
   edge or pending grant.
2. **A refused monitoring Off must retain the admitted capture (`e21d1877c780`, `4f410257b212`, #4255, #5091).**
   The setter and the toggle released eagerly before commit (#4255 narrowed the global stop to per-track but kept
   the pre-commit release; #5091 review exposed it). Start with committed and admitted On for two tracks sharing
   capture; invoke a real Off gesture inside the actual CRDT transaction; while projection is Off and committed
   state is On, reject and abort the write: both original source edges stay connected with no stop or
   reacquisition, projection returns to On. A committed Off releases only its owner; final Off stops the shared
   stream once. Pair a pending grant with committed Off, and a stored-but-unadmitted On control. Reintroduce the
   eager release in each setter and toggle route; the unchanged refused-Off integration cases must fail.
3. **Track removal releases its capture (#312, #867, #2387, #4255, #4449).** Removal released the engine strip but
   not the recorder owner. Start two tracks monitoring one input through the public AudioEngine API; delete one
   through each Arrangement removal route (single and bulk): only its source edge disconnects; delete the last: the
   MediaStreamTrack stops exactly once. Hold a permission grant through deletion, then resolve it: no deleted strip
   or edge is recreated. Abort and commit single and bulk commands separately: abort retains every edge and stream,
   commit releases only owners whose IDs are absent from committed project truth.
4. **Admitted interests and optimistic deletion cross the owner (#5011).** The subscribed Auto owner's removal
   sweep read the visible track store, so an optimistic single or bulk Command deletion disconnected Auto edges
   before a refused transaction restored the tracks, and the sweep covered only Auto-open records, leaving direct On
   interests outside store-only Off, kind-change and absence cleanup, including permission pending during a hold.
   Start through the real direct On repository and real subscribed owner; publish Off while held, change a MIDI
   track to Auto, remove one shared owner, and observe source edges and stream tracks including a late grant (never
   count only Auto-open records). Refuse and commit both deletion commands with Auto and On captures: zero
   disconnects, stops or reacquisitions on refusal, and read the raw committed document at the first edge
   disconnect and the last-owner stop. A direct On admitted before its mode flush survives an unrelated owned
   publication. Reverting the admitted-interest sweep or the committed-absence fence must fail the real capture
   probe. Eligibility: #5091's first repair treated bus, master and folder On as ineligible while the real toggle
   admitted them, and tests asserting the wrong closure passed. Start a bus through the real Auto-to-On toggle,
   publish play and stop: saved On, admitted interest and source edge survive; repeat for every owner-supported
   kind, including permission pending. Off and removal release only that owner; non-audio Auto and unadmitted
   store-only On acquire nothing. The dormant VCA row in the eligibility table is not a `TrackKind`; publishing it as
   a project track is not typed proof. Gain-node ports do not establish folder-strip creation.
5. **Disconnect faults must not strand the shared graph (#4485, #5376).** #4485 moved monitor release to the start
   of shared graph reset; a source-wide disconnect could throw before track, bus and send retirement, and disposal
   depended on that reset before master teardown and `context.close()`. Through the real reset and dispose callers
   with two controlled captures and a throwing first source: both tracks stopped, graph owners and sends retired,
   the original error retained; disposal attempts every master disconnect, awaits one close and returns the same
   terminal result on repeat; late-grant rejection stays a separate reset case. Removal faults (#4255, #4449, #5091
   `1297f963`): through real Command removal, fault targeted and whole-source disconnect independently and together;
   inspect retained captures, modeled source edges and MediaStreamTrack.stop. Last-owner release attempts every
   terminal step while reporting errors; a failed removed edge preserves the shared survivor until its own release.
   Delete two shared owners after an empty optimistic projection and throw from the first targeted disconnect:
   every removed owner releases, the final stream stops, the error is reported; repeat with visible Off, disarm and
   ineligible-kind transitions (isolating each repository release does not isolate the reconciliation sweep).
6. **Obsolete input owners during a held removal (#5283, #4449, #5011).** With track `a` monitoring On at input
   `null`, hold its real registered removal in a storage transaction and independently commit `replacement-input`
   through `mutateCrdtDoc` while `a` is absent from the optimistic projection. Before commit or abort, `a`'s obsolete
   key and edge retire immediately; a shared eligible `b` keeps the same capture, edge and stream; in the last-owner
   case the old input stops. Do not recreate the absent strip or request permission again. Abort re-admits the
   current input; commit removes `a`; a same-input abort retains its original owner and capture. #4449's keyed owner
   retargeted a key only on explicit start, and #5011's Auto-only sweep left direct On outside it (#5091 fixed
   retirement, #5380 proof).
7. **Committed Undo restores the monitoring runtime too (#5091).** Strip reconstruction alone does not restore the
   capture owners. Admit two On tracks through the real recorder, delete one and Undo, then remove all and Undo;
   inspect raw membership and modes, the store projection, actual owners, source connections and stream stops.
   Re-admit only after the restored strip and project commit, preserving the survivor's shared capture and acquiring
   a fresh stream after last-owner release. Refuse restore storage, run an isolated preview, and inject a
   published-then-throwing restore: only committed, still-present On owners rearm; denied reacquisition leaves
   restored truth and Undo success intact. Reverting either restore commit hook must redden its runtime assertion.
   Head `319cc5b5f8` still read the optimistic store after awaited strip effects: hold a second real storage
   transaction projecting On over a committed Off restoration and abort it; neither normal nor ambiguous restore
   may request capture, retain an owner or connect an edge. Change the committed selected input during the strip
   await and while permission is pending: admission uses current committed intent and a late grant attaches only
   current owners of that input. Include a shared pending survivor and last-owner removal so rejecting one stale
   restore cannot orphan another owner's capture.
8. **Grants settle against current committed intent (#5091 heads `fac4a4f061`, `2511d0c172`, `b2e7491d`,
   `3b1c0ad9`, `e9672c7966`, `71221839`).** Each head fenced one more window.
    - Ordinary On grants: hold two direct On owners on one pending input, commit deletion of one, commit the
      survivor's input selector change, then grant the old request: it connects neither the removed nor the
      switched owner and the selected input keeps the survivor's admitted intent. Repeat without a reconciliation
      subscriber (the grant itself checks). A store-only On track is not a new admission; an unrelated publication
      preserves an unflushed explicit On and an unchanged global input selection.
    - Grant inside the optimistic-removal window: open a real removal storage transaction, settle both a direct On
      and a committed-rearm grant while the row is absent, then abort: the committed owner keeps capture without
      recreating a stripped edge before rollback, and reconnects when the row returns without reacquiring
      permission. Committed deletion, Off, selector replacement and teardown still reject the old grant. Await the
      actual settlement; a snapshot after abort misses lost authority. Armed, stopped Auto: settle the pending grant
      while a removal hides its row, abort: raw committed kind, arm, mode and input keep that device without
      recreating the strip, and rollback attaches the original grant with no second request. Disarm, Off, input
      change, committed deletion, non-audio Auto and playback without recording still reject it; a monitoring hold
      keeps an eligible retained grant detached until resume. On-only absence and already-granted Auto probes miss it.
    - Pre-commit On over committed disarmed Auto (`b2e7491d`): begin the gesture in a real storage transaction,
      delete the authoritative owner while the On row stays projected, then grant before abort: no strip or edge,
      and the unused stream stops once. Pair a still-present owner and a shared pending survivor; an isolated
      runtime without a committed provider is a separate positive control.
    - Stale On after supersession (`3b1c0ad9`): presence alone did not protect current intent. Hold the optimistic
      gesture over committed Auto, commit each supersession (Off, input replacement), grant the old request before
      abort: zero strip creation, edges, owners and captures, one orphan-stream stop. A relevant committed mode,
      input, kind or arm change takes authority; unchanged Auto/Off and an unrelated commit still permit the gesture.
      Pair shared survivors and an already-admitted selected-input replacement so rejecting the old grant cannot
      retire current permission authority.
    - Root replacement (`e9672c7966`, `71221839`): replace the installed root while an optimistic On grant over
      committed disarmed Auto is pending, keeping track ID, mode, input, kind and arm; repeat after real Command Undo
      restores On and returned `headConsumed`. Each outgoing grant stops unused with no strip, edge, owner or
      capture in the successor; a fresh successor On admission then connects both same-input owners with the stale
      settlement neither deleting their authority nor stopping their shared stream. Also replace the root while On
      permission is pending, then change the same-ID owner's input through the real action: no second request or
      successor edge from the old reader, paired with a successful `replaceCrdtDocInLineage` retarget. Capture
      authority before publication and retain the fence in every reusable reader, never recapturing the current
      root on reconciliation. Deleting the root-identity fencing in shared admission, including the retained reader,
      must redden both replacement cases.
9. **Hold and the other removal callers (#5091).** Hold the subscribed owner and change the selected input
   repeatedly: no new acquisition until resume chooses the current input. Repeat for every eligible track kind and
   while the original permission is pending: settle the stale grant during the hold, its stream closes, its edge
   stays absent, and the original admission authority is retained until resume; Off, removal and ineligibility
   retire it immediately; explicit restore rearm during a held graph repair is a separate authorized opening.
   Handler-only deletion probes missed the real callers: invoke palette Delete Track through its registered action,
   refuse storage, and committed and visible membership, selection, history and shared capture survive; committing
   afterward releases only the removed owner. Enumerate direct import cleanup, render Undo and stem replacement from
   source: runtime cleanup follows committed absence without changing their history route. An unscoped refused write
   keeps committed owners while pending, and a successful retry finalizes only its removed owner. Abort and replace
   the project root with a reused track ID: observe observer retirement, then publish a later removal to prove the
   outgoing finalizer cannot tear down the recreated strip.

10. **Worker-ready recording admission reaches the real first-frame seam.** Capture started from a worker-ready
    continuation while the command already returned success before the worklet captured input. Hold worker readiness
    through the real recorder-to-transport route and drive the first nonempty processor block at a known
    `AudioWorkletGlobalScope.currentFrame`. No successful-start observable and no uncaptured transport interval may
    exist before the actual sample-zero receipt, and exactly one start follows it. A returned boolean, the
    worker-ready message, main-thread callback time or a pre-resolved recorder mock cannot establish capture-clock
    alignment; resolving the start on worker readiness must fail the case.
11. **Recording ring publication brackets every copy.** A pre-copy cursor check can admit mixed PCM, and a signed or
    low-word rollover can make a full ring turn look empty. Drive real 128-frame writes across signed and unsigned word
    rollover, at capacity minus one, exact and plus one, and with a writer paused inside the consumer copy. The worker
    copies only an interval bracketed by the same stable sequence and cumulative count, retries an in-progress or
    changed copy, and abandons a lapped interval rather than write substituted PCM. Publishing a signed 32-bit cursor
    as the history contract, or the count before the odd sequence, must fail a case.
12. **The recording stop fence keeps its deadline through acknowledgment.** Clearing the stop deadline on the producer
    acknowledgment let a stalled final drain retain the input session indefinitely. Accept only the captured
    session's producer-stop acknowledgment, make one final worker drain against that count, and keep the original
    flush deadline armed through acknowledgment. A missing acknowledgment or flush cleans that exact captured session
    without touching a successor for the same track; clearing the deadline on acknowledgment must fail.
13. **Recording artifact identity is independent of wall-clock time.** Generate one cryptographically unique temp-file
    name at worker initialization. Run two isolated workers sharing a filename-keyed staged OPFS at one timestamp:
    each delivered WAV keeps its own PCM, and removing one staging entry does not remove the other's.

## Retired lessons

- Aborted graph repair must rearm committed monitoring intent (#5286) -> enforced by
  `src/modules/Transport/useCases/__tests__/repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts`
  "rearms committed On when Off is projected %s and then aborted", "does not reopen a monitor whose Off version
  commits during plugin reset", "does not reset or rearm the replacement root after an outgoing plugin reset" and
  "settles repair and aborted history while rearm permission remains pending and then refuses", and by
  `repairRuntimeGraphFromProject.autoMonitoring.spec.ts` "requests no microphone at any point while the transport is
  playing" and "requests the microphone exactly once more when the transport is stopped".
