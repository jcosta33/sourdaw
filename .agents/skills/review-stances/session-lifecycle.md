# Lesson library: session lifecycle

Lesson library for defects in a runtime session's lifecycle — anything that starts, stops, parks,
replaces or disposes a long-lived runtime the app holds on behalf of a user-facing mode: the
native live graph session, the playhead scheduler, the playhead feed, a recording session, a
plugin host instance, a collaboration transport. Per the Review section of `AGENTS.md`, this
directory is a lesson library, not a stance menu: an escape — a defect that reached `main` whose
defect class matches this file — is recorded here as a lesson, and every dispatch whose derived
stance matches this file carries its lessons. Lessons state the escape, the blind spot, and the
probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

## Standing probes

- Enumerate the gestures that can reach the lifecycle from the module's own control surface — the
  directory of use cases that owns them — and never from the diff. The diff shows which gestures the
  author thought about; the directory shows which ones the user can press.
- For each gesture, state what the runtime is left holding afterwards, and whether that contradicts
  what the UI now claims. A runtime whose state disagrees with the visible state is the defect class
  this stance exists for, whether or not it is audible yet.
- Walk the pairs, not only the singles: gesture-then-gesture inside one round trip, the second
  gesture arriving while the first is still in flight, and the gesture that is a no-op on its own
  but changes what the next one means.
- A lifecycle call fired without awaiting is ordered by whatever queue the runtime serialises on.
  Name that queue and say which command wins; "fire and forget" is a claim about failure handling,
  never about ordering.
- A lifecycle whose consequence is gated off today (behind a capability flag, an empty topology, a
  build that declines) still gets the full walk. The gate is a schedule, not a contract, and the
  next slice is what removes it.

## Lessons from escapes

### 2026-10-08 — shutdown reclamation needs a release inside the poll pass (introduced by PR #2976)

The native CI failure on PR #5064 occurred after the plugin's stop and destroy assertions passed;
the final whole-cascade wall-clock assertion was 252.790917 ms against 250 ms. That result does not
identify which cascade step or thread scheduling delay consumed the time.

Blind spot: the test needed to pin the scheduler-release transition itself. Keep an extra runtime
owner through the first retirement sweep, release it inside the first 2 ms poll callback, and require
the next sweep to destroy it before another wait. Independently hold the owner across a synthetic
wait longer than the 500 ms budget and require a retained, named abandonment with no second poll.
This tests the lifecycle boundary and measured-wait budget without timing unrelated shutdown steps.

### 2026-08-29 — the gesture nobody walked (escaped via PR #3073, filed as #3096)

PR #3073 (#3066) wired native live graph session start and stop into `startPlayback` and
`stopPlayback`. Review attacked play/stop/play cycles hard — re-entry, replaced topology, a stop
overtaking its own start — and every finding was about a gesture the diff touched. Nobody walked
**pause**, which is a separate use case the diff never opened. Pause therefore shipped leaving the
native engine's transport `is_playing: true` with its clock advancing under a paused UI, and only
the next slice's author found it.

Blind spot: the stance took the diff's own set of gestures as the set of gestures. A lifecycle
change is not scoped by the files it edits — it is scoped by every entry point that can reach the
runtime it changed, and the ones it did not edit are exactly the ones that now disagree with it.

Probe that would have caught it: list the transport's gestures from `transportControls/` rather than
from the diff — play, pause, resume, stop, stop-after-pause, seek while playing, seek while stopped,
record, loop toggle — and for each, name the state the native session is left in and whether it
contradicts the transport state the UI shows. One line per gesture; a gesture with no answer is the
finding.

### 2026-08-31 — unmount is a Connect gesture (escaped via PR #3226)

PR #3226 inserted a 15s probe between opening a credential session and `replace_runtime`. Overlapping
Connect was treated as unreachable because `configurationPending` disables the button. `AiSection`
unmounts when Preferences leaves AI (`section === 'ai' ? <AiSection /> : null`), which drops that
flag, so a second Connect can start while the first probe is alive; the first then overwrites the
second.

Blind spot: a local pending flag on a conditionally mounted control surface is not a lifecycle lock.
Gestures include leaving the surface and coming back.

Probe that would have caught it: for any change that puts a network/IPC wait between opening a
session and installing it, walk Connect, then leave-the-section-and-return, then Connect-again
before the first wait settles. Name which runtime is installed. If it is the first, that is the
finding.

### 2026-09-08 — the window a start steps over (escaped via PR #4020)

PR #4020 aimed the native session's roll at the position Web Audio had reached during the session's
own start-up (75–88 ms after the click) and located there. The MIDI arm before the roll had queued
the note pass from the parked position, and the engine scans its store from the block start, so
every note-on in the skipped window was never delivered — a chord on the downbeat of a
native-hosted instrument was silent for its whole length. The header justified the skip with "Web
Audio sounded that stretch" and "the engine counts those late"; both were untraced and both were
false: the carried strip's Web Audio gate is pinned to zero 50 ms after the claim, a native-hosted
instrument has no Web Audio voice at all, and the late counter runs at store time against the
parked playhead.

Blind spot: the stance attacked the seek's effect on queued mixer writes and the loop seam, and took
the diff's coverage claim about the other carrier as given. A runtime that moves its position
relative to material another step already queued is stepping over that material; whether anything
else sounds it is a code question, not a doc sentence.

Probe that would have caught it: for any start, resume or re-arm that changes where the runtime
begins relative to the position its arms and topology were built for, name the material stamped in
the difference and trace two things on the head: the store's delivery bound
(`partition_point(|entry| entry.at_frame < block_start)` in `enqueue_due_midi_notes`) against the
arm's stamps, and the other carrier's gate ramp and voice presence (`TrackNode.setNativeCarried`,
`CARRIER_GATE_LANDING_SEC`; a native-hosted instrument has no Web Audio voice). Material nothing
delivers is the finding; a claim that "the other carrier covers it" without those two traces is
discarded.

### 2026-09-09 — the correction removed for every caller (caught in review of the #4020 repair)

The repair for the entry above deleted the roll projection from the shared session start rather than
from the one caller it was wrong for. Holding the Web Audio start is what makes a projection
unnecessary, and only `startPlayback` can hold; the mid-play re-arm joins a transport that has been
sounding for seconds and cannot. Removing the correction for both would have left a re-armed engine
rolling at the beat read before its own start round trips and staying that far behind Web Audio for
the rest of the play, with the position feed pulling the cursor back. When a change removes a
correction from a shared start, the reviewer enumerates every caller and states, per caller, what
replaces it; a caller whose transport is already rolling cannot hold and must project.

Probe: `grep -rn startNativeSessionAtBeat src/modules --include='*.ts' | grep -v __tests__`, then
read each caller and name what stands in for the deleted correction there. A caller with no answer
is the finding, and "the shared path handles it" is not an answer unless that path can distinguish
the callers.

### 2026-09-19 — the acquisition cache keyed by nothing (escaped via PR #4394, fixed in #4423)

PR #4394 let two tracks record from different audio devices, but the input-monitoring session stayed
a singleton holding one monitor source and one pending acquisition, and `startInputMonitoring(trackId,
inputId)` returned an existing source without ever comparing the requested input. The cache was keyed
by nothing while the caller passes an identity, so one request silently served a different endpoint: a
musician monitoring two armed tracks heard the first device for both while each track recorded its
own. The manual On entry points never passed the track's selection at all, so enabling a monitor from
the UI opened the global/default capture even when the track names its own device.

Blind spot: the stance walked the recording path's own inputs and took the monitor session as one
shared runtime rather than an acquisition cache keyed by the caller's identity. A cache that ignores
the argument it is handed makes every later caller an alias of the first, and an entry point that
drops the identity degrades to the same default for everyone.

Probe that would have caught it: assert at the monitor outputs, never at forwarded identifiers. Two
tracks requesting different inputs must yield two acquisitions and two distinct sources, each track
edge fed by its own source, and the manual enable path must carry the track's own selection into the
engine call. Restore the singleton reuse — attach to whatever source exists while ignoring the
requested key — and the assertion reddens, as it does at #4423.

Ownership half: a per-track edge and a per-key stream are released exactly once, and one key's failed
acquisition must not disturb another key's source, edge, or pending grant.

### 2026-09-20 — live cancellation is not durable cancellation (escaped via PR #1949)

PR #1949 (`ce2ffea3fd`) made pending-confirmation cancellation revoke its run before cleanup, but
its already-terminal retry trusted live state after local persistence failed. Inject a real
`Storage.setItem` failure during cancellation, assert that the live run is terminal while the saved
run is unchanged, then cancel the same confirmation again. The retry must persist that exact run
before releasing either temporary run assets or confirmation resources, and must not report success
while cleanup remains pending. Repeat without temporary assets: an already-terminal no-op cannot
prove persistence. A mocked cancellation helper misses the live-store-before-storage failure seam.

### 2026-10-08 — deleting a track left its input capture alive

PR #312 added `removeTrackStrip` and `removeBusStrip` calls to `removeTrack`; bulk removal already
looped through `removeTrack` before PR #2387. PR #867 made runtime strip teardown deferrable, and
PR #2387 added bulk-removal undo snapshots. PR #4255 later gave the shared monitor capture
per-track edges and pending owners, and PR #4449 keyed captures by input while retaining per-track
ownership. Before this fix, track removal released the engine strip without releasing that recorder
owner. The missing lifecycle probe crossed the Arrangement and recorder owners: deleting the last
monitored track could leave its MediaStream running, while deletion before a pending grant could
recreate an edge for a removed track. Bulk deletion also needed proof that aborted project writes
retain live resources.

Probe: start two tracks monitoring one input through the public AudioEngine API. Delete one through
each Arrangement removal route and check that only its source edge disconnects; delete the last and
check that the MediaStreamTrack stops exactly once. Hold a permission grant through deletion, then
resolve it and check that no deleted strip or edge is recreated. Abort and commit the single and
bulk commands separately: the abort must retain every edge and stream, while the commit releases
only owners whose IDs are absent from committed project truth.

### 2026-10-09 — admitted interests and optimistic deletion cross the monitor owner (PR #5011)

PR #5011 added the subscribed Auto owner. Its removal sweep read the visible track store, so an
optimistic single or bulk Command deletion disconnected Auto edges before a refused transaction
restored the tracks. It also swept only its Auto-open records, leaving direct On interests outside
store-only Off, kind-change and absence cleanup, including permission still pending during a hold.

The final reviewed-head bundle's strongest draw attacked newly merged main changes; its economy
draws attacked the merged contract and existing probes. Their recorded admissions and baseline
probes did not demand direct On admission or refused optimistic deletion. Those records establish
the prompt gap on that head; they do not establish what unrecorded reviewer work covered or that a
higher tier alone would have caught it.

Probe: start through the real direct On repository and real subscribed owner, then publish Off
while held, change a MIDI track to Auto, and remove one shared owner. Observe the actual source
edges and stream tracks, including a late permission grant; never count only Auto-open records.
Separately refuse and commit both deletion commands with Auto and On captures, require zero
disconnects, stops or reacquisitions on refusal, and read the raw committed document at the first
edge disconnect and last-owner stop. Preserve a direct On admitted before its mode flush while an
unrelated owned publication occurs. Reverting the admitted-interest sweep or committed-absence
fence must fail the corresponding real capture probe.

Monitoring capability comes from Arrangement's `getTrackEligibility(...).acceptsMonitoring`, not
from a recorder-owned list of kinds. PR #5091's first repair incorrectly treated bus, master and
folder On as ineligible while the real toggle admitted them. Tests asserting those wrong closures
passed without proving admission. Start a bus through the real Auto-to-On toggle, publish play and
stop, and require saved On, admitted interest and its source edge to survive; repeat for every
owner-supported project kind, including permission still pending. Off and removal must release only
that owner; non-audio Auto and unadmitted store-only On must acquire nothing. The eligibility table's
dormant VCA entry is not a valid `TrackKind`: publishing it as a project track is not typed caller
proof. Controlled gain-node ports prove ownership, not actual folder-strip creation or hardware audio.

### 2026-10-09 — monitor release must be paired with committed Undo restoration (caught in PR #5091)

The committed-deletion probes proved release and refused-deletion preservation but omitted the
actual inverse. Real Command Undo restored the track and its saved On mode while the recorder
held only the surviving track's edge; bulk Undo restored both On tracks with no capture owners.
Strip reconstruction alone does not restore the independent monitoring runtime.

Probe: admit two On tracks through the real recorder, delete one and Undo, then remove all and
Undo. Inspect raw document membership and modes, the store projection, actual monitor owners,
source connections and stream stops. Require re-admission only after the restored strip and
project commit, preserving the survivor's shared capture and acquiring a fresh stream after
last-owner release. Refuse restore storage, run an isolated preview, and inject a published-then-
throwing restore; only committed, still-present On owners may rearm. Denied reacquisition must
leave restored truth and Undo success intact. Reverting either restore commit hook must redden
its connected runtime assertion.

The restoration repair in PR #5091 (`319cc5b5f8`) still read the optimistic store after
awaited strip effects. Hold a second real storage transaction projecting On over a committed
Off restoration, then abort it: neither normal nor ambiguous restore may request capture,
retain an owner, or connect an edge. Change the committed selected input during the strip
await and while permission is pending; admission must use current committed intent and a late
grant must attach only current owners of that input. Include a shared pending survivor and
last-owner removal so rejecting one stale restore cannot orphan another owner's capture.

The follow-up head in PR #5091 (`fac4a4f061`) fenced restored owners but left ordinary
On grants unfenced. Hold two direct On owners on one pending input, commit deletion of one,
commit the survivor's input selector change, then grant the old request: it must connect neither
removed nor switched owner, and the selected input must retain the survivor's admitted intent.
Repeat without a reconciliation subscriber to prove the grant itself checks current intent.
A store-only On track is not a new admission, and an unrelated publication must preserve an
unflushed explicit On and an unchanged global input selection.

The deletion probe also omitted disconnect faults. PR #4255's per-track release and PR #4449's
keyed capture path could remove the logical owner, throw from the targeted disconnect, and
leave the last capture's stream running; a whole-source disconnect throw could skip stream stop.
Through real Command removal, fault targeted and whole-source disconnect independently and
together. Inspect retained captures, actual modeled source edges and MediaStreamTrack.stop,
not only owner keys. Last-owner release must attempt every terminal step while reporting errors;
a failed removed edge must preserve the shared survivor until its own eventual release.

The follow-up head in PR #5091 (`2511d0c172`) checked settled captures through refused deletion,
but omitted permission settlement inside the optimistic-removal window. Open a real removal
storage transaction, settle both direct On and committed-rearm grants while the row is absent,
then abort. The committed owner must retain capture without recreating a stripped edge before
rollback, and reconnect when the row returns without reacquiring permission. Committed deletion,
Off, selector replacement and teardown must still reject the old grant. Await the grant's actual
settlement and inspect owner, edge and stream state; a snapshot after abort misses lost authority.

The same head's hold probes walked Auto opens and immediate On cleanup, but omitted an admitted
On selector change. Hold the subscribed owner, change the selected input repeatedly, and require
no new acquisition until resume chooses the current input. Repeat for every eligible track kind
and while the original permission is pending: settle the stale grant during the hold, require its
stream to close and its edge to stay absent, then retain the original admission authority until
resume. Off, removal and ineligibility still retire that authority immediately. Explicit restore
rearm during a held graph repair remains a separate authorized opening.

Handler-only deletion probes missed the real palette entry and other direct removal callers.
Invoke palette Delete Track through its registered action, refuse storage, and require committed
and visible membership, selection, history and shared capture to survive; committing afterward
releases only the removed owner. Enumerate direct import cleanup, render Undo and stem replacement
callers from source. Their runtime cleanup must follow committed absence without changing their
history route. For an unscoped refused write, assert that committed owners survive while the write
remains pending, then that a successful retry finalizes only its removed owner. Abort and replace
the project root with a reused track ID: observe observer retirement and publish a later removal
to prove the outgoing finalizer cannot tear down the recreated strip.
