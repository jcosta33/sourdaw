# Lesson library: session lifecycle

### 2026-10-29 — an editor connection owned the acceptance document lifetime

Playwright's dev-server route dates to `0ef2e91d94`; #5363 kept the source-module companion
and #5738 consolidated its child lifecycle. The Vite 8.3.5 pin in #5748 retained an
unconditional disconnect/ping/reload branch even when updates were disabled. Historical
private review prompts and tiers are unavailable. The missed lifecycle probe separates
editor WebSocket loss from healthy application HTTP and pending module ownership.

With an actual held App import, disconnect only the fixture's established socket while
health remains available. Require same-document App and CSS completion with HMR off, and
an observed CDP reload plus successful successor completion under default developer HMR.
Keep the transport connected initially and retain CSS exports and custom/error delivery;
disabling WebSockets altogether introduces connection errors rather than proving isolation.

Lesson library for defects in a runtime session's lifecycle — anything that starts, stops, parks,
replaces or disposes a long-lived runtime the app holds on behalf of a user-facing mode: the
native live graph session, the playhead scheduler, the playhead feed, a recording session, a
plugin host instance, a collaboration transport. Per the Review section of `AGENTS.md`, this
directory is a lesson library, not a stance menu: an escape — a defect that reached `main` whose
defect class matches this file — is recorded here as a lesson, and every dispatch whose derived
stance matches this file carries its lessons. Lessons state the escape, the blind spot, and the
probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

### A cold MIDI strip must initialize from the node-backed projection

PR #2035 introduced runtime topology construction for every project device; PR #2083 later
excluded Yeast but left scheduler synth and drum devices in the Web Audio chain projection.
A MIDI track can therefore carry valid project instruments with no Web Audio node beside a
node-backed effect. The missed lifecycle input was an effect edit before the strip exists;
historical private reviewer prompts and tiers are unknown.

Exercise a cold strip and an already initialized strip with a MIDI synth or drum and an effect.
Apply the real add, Undo and Redo route: project and native snapshots must retain the complete
instrument and effect identities, while Web Audio initializes or reconciles only node-backed
members. Keep unknown device types visible for ordinary construction refusal, and refuse a
mismatched existing strip rather than treating it as initialized. An instrument-only edit must
also preserve full native truth. Remove the projection or cold-strip admission and require its
corresponding case to fail.

## Standing probes

- PR #5091's head `71221839` fenced grant settlement but retained an unfenced reusable
  admission reader. A root-ownership stance must replace the root while On permission is
  pending, then change the same-ID owner's input through the real action. Require no second
  request or successor edge from the old reader; pair `replaceCrdtDocInLineage` input changes
  with a successful retarget. Capture authority before publication and retain that fence in
  every reusable reader, rather than recapturing the current root on reconciliation.

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

### 2026-10-28 — entry recovery must not navigate an already running document (#5595)

Commit `33158adccb2b0ed6a461fee10dde79c83c2b2fcf` left startup without independent
entry-failure handling; no introducing PR or private review history is established. A repair that
retries every import failure would cross a different safety boundary: parallel bootstrap can
still be pending while a project or recording is live. Establish entry-body start before any
composition or application effects, prove its static dependency closure is pure, then deliver a
late entry-targeted error with a live project and recording. Require unchanged document lifetime,
runtime and visible project. A capability marker's absence is insufficient admission. Fail an
actual child entry separately and preserve the host's time origin; share one per-tab retry budget
across host and child, never replenishing it on successful startup. Storage failure requires
manual recovery. Removing the phase fence or shared budget must fail the corresponding probe.

### 2026-10-27 — unsupported NAM replacement needs sounding-model preservation (introduced by PR #5209)

PR #5209 (`54ff77cd1f930903d6e5a6f9024a45c87b67b063`) introduced the real NAM runtime
with an admitted stacked-wide LSTM shape whose deeper input width contradicts its render buffer.
The missing coverage obligation is replacement refusal while an existing capture is sounding;
historical private reviewer prompts, assigned stances and model tiers are unknown.

Activate Capture mode and advance two identical loaded engines with identical input. Attempt the
unsupported replacement on one only, then require its subsequent PCM to equal the continuing
reference without a reset. Require nonzero output separated from a matched unloaded/dry control.
`has_loaded_neural_model` plus finite output can pass while Circuit mode bypasses the capture.
Pair empty-engine refusal with both supported topology boundaries; preserve the selected library
entry at the real import UI. This proves the exercised shared/WASM route, not native transport or
physical playback acceptance.

### 2026-10-27 — cached preview sources outlived their engine graph (preserved by PR #187)

Commit `454de02a76069e5cec5fcee104eb9a64521e2f97` introduced the UI-owned preview source:
Stop stopped it and natural completion cleared UI state, without disconnect or engine-lifetime
cleanup. GitHub's commit-to-PR lookup returns no associated PR. PR #187
(`8c11c40674b32074a12a209b308d3361e93fe873`) moved that behavior into AudioEngine's cached
preview helper. Historical private review prompts and tiers are unavailable.

Start a cached preview through its real owner, then reset or dispose the engine. Require the source
to stop and disconnect before the outgoing graph is retired, with one completion notification and
no admission against the outgoing lifetime. Start a successor during an old callback and deliver
the old completion and release afterward; the successor must survive. Pair nested reset, cleanup
failure and disposed-engine refusal with ordinary previews that still coexist. Removing reset
invalidation or the disposed-owner guard must fail those cases. Intent currentness permits
preparation only; native monitoring readiness, programme isolation and audible A/B need their own
evidence.

### 2026-10-22 — a store hydrate on a sync reset the runtime-only fields (introduced by PR #171)

PR #171 (commit `d764229f1`) gave `transportStore` a `fromCrdt` that expands the partial document slot to a
full state seeded from defaults, and rewrote the hydrate spec to expect the cached `isPlaying`,
`isRecording` and `playheadPosition` to be dropped ("without preserving stale cached fields"). The adapter's
hydrate merge, `{ ...localValue, ...authorityValue }`, then overwrote those runtime keys on every
projection that was not a project load. A collaborator's tempo edit, or any remote change after a local
transport edit, stopped playback and recording and left the open take uncommitted. Only the local-commit
path restored the keys (`projectCommittedLocalState`).

Blind spot: the stance walked the project-load gesture, for which "start from defaults" is the contract,
and took the spec asserting it as proof it was right for a sync. A store hydrate has two callers with
opposite contracts: a load starts every field from the document, a re-projection of the open project
(sync, merge, branch switch) must leave the fields the store never persists alone. Drive the real
repository, `setupProjectionBridge`, the store and `replaceCrdtDocInLineage` with the runtime fields set
(playing, recording, playhead at a nonzero beat), apply a remote change to that store's own slot and one
to an unrelated slot after a local edit, and require the runtime fields to survive while the durable field
takes the remote value. A spec that sets a runtime field and expects hydrate to drop it is the escape's
fingerprint: ask which caller it speaks for.

### 2026-10-29 — failed Freeze settlement needs current attempt authority (PR #2597 escape)

The #2597 diagnostic/no-history escape requires a separate failure settlement after the render
refuses. That continuation must still belong to the exact project root, revision, task and freeze
aggregate when admitted and immediately before commit. A track ID or reused project timestamp
cannot establish ownership, and the old attempt must not clear a newer task in its finalizer.

Hold settlement admission and separately its staged-write commit boundary. Cancel, start a newer
task, replace the root with the same timestamp and track ID, remove/recreate the track, or replace
its take. Require the successor to survive with no failed-Freeze history. Pair each refusal with
a genuinely current retry that persists its reason and later freezes, undoes and redoes normally.
The missed real Command/durable-state stance cannot be replaced by a direct use-case callback.

### 2026-10-08 — shutdown reclamation needs a release inside the poll pass (introduced by PR #2976)

The native CI failure on PR #5064 occurred after the plugin's stop and destroy assertions passed;
the final whole-cascade wall-clock assertion was 252.790917 ms against 250 ms. That result does not
identify which cascade step or thread scheduling delay consumed the time.

Blind spot: the test needed to pin the scheduler-release transition itself. Keep an extra runtime
owner through the first retirement sweep, release it inside the first 2 ms poll callback, and require
the next sweep to destroy it before another wait. Independently hold the owner across a synthetic
wait longer than the 500 ms budget and require a retained, named abandonment with no second poll.
This tests the lifecycle boundary and measured-wait budget without timing unrelated shutdown steps.

### Cold frozen export restoration must finish before rendering

The clip-only restoration set introduced by `57b7349f7864eca0bd177333d720a50186bd33e9`
survived the owner-use-case routing in `ab5a579209b5e02a035e123380b5ceaf9c922250`
(associated with PR #187); no PR is associated with the narrowing commit, and historical
review dispatch is unknown. The missed lifecycle input is a fresh runtime whose active frozen
print is durable but absent from memory alongside an ordinary clip.

Hold restoration and require no render or encode; release it through the real cache owner and
require active frozen PCM in both mixdown and stems. Remove only its requested ID and require
failure before encoding. Preserve stale-print exclusion, the empty-clip fallback, cancellation,
and the current dialog session fence; a late older callback must not paint a reopened dialog.

### VCA membership must reach committed runtime gain

The Inspector's direct calls introduced in `22a84b216658f593391e7e141d90f7c84d13648b`
bypassed the committed gain continuation added by PR #1049. The missed route was the actual
Inspector gesture reaching that continuation; historical private review prompts and tiers are
unknown.

Drive Create, Assign and None through the mounted gesture, real Command, handler and reconciler.
At the engine caller, require raw CRDT and projection to agree and observe composed static or
automated gain at the selected beat through the gesture, Undo and Redo. Seed a non-unity group
and an automated peer, check the scheduled value and absence of duplicate subject scheduling,
and preserve unrelated tracks. Revert the matching component dispatch and require its history
and gain case to fail. This controlled engine boundary does not establish audible output.

Preserve project identity across a gesture waiting for a root snapshot. A same-ID successor must
not receive the queued gesture; an ordinary snapshot on the same project must still allow it.
Hold and release the real queue around production root replacement and inspect successor state,
history and engine calls. This successor case was caught during #5789 review before merge.

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

### Crumbs waveform work must retain its actual root and device incarnation

The sampler continuation introduced by `c8c1257477838ab15d98b5ea6b38e821ddb4ad57`
could publish after its device or root was replaced; PR #5041's per-ID decode sequence did
not establish lifetime authority (#5780). No introducing public PR or historical private
review prompt/tier is established.

Hold telemetry and peaks through the actual app-injected owner reader. Replace an identical-ID
root and remove/restore the same device object while its preceding view is still present.
Observe every committed owner transition before coalescing reconciliation, so absence/type/
owner/duplicate ABA cannot revive an old token. Do not start a newer load or replace its sample
leaf before the refusal assertion: those guards would hide a missing lifetime fence. Keep real
ordinary parameter writes and fresh successor loads as controls. Remove synchronous owner
refresh and require the unchanged ABA case to fail. This proves display authority, not native
sample selection or audible last-drop ordering.

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

### 2026-10-28 — a Levain init fault must not announce a healthy engine (#5227)

The buffered pre-init loop first appears in commit `90bc7995e44e809aa96d810bdf8b5e0b5f629a57`;
GitHub returned no associated PR. PR #946 added bank-local rejection for live handlers while
buffered replay still escaped through init's outer catch. PR #5204 later documented the wider
message-state contract. Historical private review prompts and tiers are unknown. PR #5587 repaired
the bank-local replay path, but a failed engine creation could still post `ready` on a later init
while retaining its terminal fault, and no maintained case counted a repeated `disposed` reply.

Drive the raw port through a failed init, another init, a bank start and a release. Require the
original error each time, no engine creation, replay or healthy ready, and no rendered block;
preserve a fresh processor's successful init and bank-local replay. Dispose the same processor
twice and require two replies plus a completed paced drain. Refusing a second init must not alter
the shipped node's first-init readiness or the owner/follower bank lifecycle. Remove the terminal
init refusal or repeated-dispose answer separately; each unchanged named regression must fail.

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

### Monitor disconnect faults must not strand the shared graph (introduced by PR #4485; fixed in #5376)

PR #4485 moved monitor release to the start of shared graph reset so source edges stopped while
strips still existed. A source-wide disconnect could throw before track, bus and send retirement;
disposal then depended on this failing reset before master teardown and `context.close()`. Public
approval covers ordering and late-grant release, not fault continuation; private prompts and tiers are
unknown. Exercise the real reset and dispose callers with two controlled captures and a throwing first
source: require both tracks stopped, graph owners and sends retired, and the original error retained.
Disposal must attempt every master disconnect, await one close, and return the same terminal result on
repeat. Keep late-grant rejection as a separate reset case. Controlled nodes and media prove cleanup,
not physical microphone or audible playback.

### An aborted graph repair must rearm committed monitoring intent (issue #5286)

Start a connected On track, hold same-project graph repair at plugin reset, then project Off before
repair and during reset in separate real version restores that abort. While held, observe committed
root On beside projected Off. After abort, require rebuilt-strip monitoring to acquire a fresh
source, connect it only to the rebuilt gain, stop the old source once, and leave history empty.
Also commit Off during reset and replace the root: neither may reopen monitoring or rearm the
successor strip. Keep pending and refused permission controls, and require armed Auto to follow the
final transport state. The controlled media and graph ports prove lifecycle ownership, not physical
hardware audio; the connected oracle is in `repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts`
and `repairRuntimeGraphFromProject.autoMonitoring.spec.ts`.

### Obsolete input owners during a held removal (issue #5283)

With track `a` already monitoring On at input `null`, hold its real registered removal in a
storage transaction and independently commit `replacement-input` through `mutateCrdtDoc` while
`a` is absent from the optimistic projection. Before commit or abort, retire `a`'s obsolete key and
edge immediately. A shared eligible `b` must retain the same capture, edge, and stream. In the
last-owner case, the old input must stop. Do not recreate the absent strip or request permission
again. On abort, re-admit the current input; on commit, remove `a`. A same-input abort must retain its original
owner and capture.

PR #4449 first introduced the keyed-owner form after #576's held transactions and #4255's shared
edges. Its source retargeted a key only on explicit start, and its public tests and review covered
start, grant, shared ownership, and stop, not an independent committed selector change under
optimistic absence. Older code already retained stale singleton audio, so the earliest origin of all
stale physical edges is unproven. PR #5011 later added an Auto-only sweep that left direct On
outside it; #5091 fixed retirement. The #5380 proof uses controlled media and graph ports, not
physical hardware.

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

PR #5091's follow-up head `1297f963` retained optimistic absence but missed two owner transitions.
Delete two shared owners after an empty optimistic projection and throw from the first targeted
disconnect: every removed owner must still release, the final stream must stop, and the error
must remain reported. Repeat the fault with visible Off, disarm and ineligible-kind transitions;
isolating each repository release does not isolate the surrounding reconciliation sweep.

Settle a pending armed, stopped Auto grant while a real removal transaction hides its row, then
abort. Raw committed kind, arm, mode and input must retain that device without recreating the
missing strip; rollback attaches the original grant without another permission request. Disarm,
Off, input change, committed deletion, non-audio Auto and playback without recording still reject
the old grant. A monitoring hold keeps an eligible retained grant detached until resume. On-only
absence probes and already-granted Auto probes miss this settlement boundary.

PR #5091's head `b2e7491d` allowed a pre-commit On gesture over committed disarmed Auto,
but its pending grant still trusted the optimistic row after committed deletion. Begin that
gesture in a real storage transaction, delete the authoritative owner while the On row stays
projected, then grant permission before abort: no strip or edge may be created, and the unused
stream stops once. Pair it with the still-present owner and a shared pending survivor. An
isolated runtime without a committed provider remains a separate positive control.

The same admission window at `3b1c0ad9` still accepted stale On after committed Off or an input
replacement: presence alone did not protect current intent. Hold the optimistic gesture over
committed Auto, commit each supersession, then grant the old request before abort. Inspect zero
strip creation, edges, owners and captures plus one orphan-stream stop. A relevant committed
mode, input, kind or arm change must take authority; unchanged Auto/Off and an unrelated commit
must still permit the gesture. Pair shared survivors and an already-admitted selected-input
replacement so rejecting the old grant cannot retire current permission authority.

PR #5091's grant fence was introduced in `2511d0c172` and refined in `46c03b3ab9`, but head
`e9672c7966` still identified an admission only by track intent. Replace the installed root while
an optimistic On grant over committed disarmed Auto is pending, preserving the same track ID,
mode, input, kind and arm; repeat after real Command Undo restores On and has already returned
`headConsumed`. Each outgoing grant must stop unused without creating a strip, edge, owner or
capture in the successor. A fresh successor On admission must then connect both same-input owners
without the stale settlement deleting their authority or stopping their shared stream. Removal
continuation probes do not exercise this incoming grant boundary; deleting the root-identity
fencing in shared admission, including its retained reader, must redden both replacement cases.

### 2026-10-26 — user and automatic Stop outlived their recording root (issue #5517)

Unfenced recording closure originates in commit `0249a95cc5292` (associated PR unverified);
PR #4564 (`40c5218228c5`) added the asynchronous MIDI commit and failure-discard continuation.
Neither route captured the installed root when the take opened. Successful Stop/Undo tests
missed an outgoing recording resumed under a replacement root; historical review dispatch is
unverified. A capture-terminal guard does not cover these separate Stop routes.

Drive both user Stop and automatic punch-out with a real captured-root identity. Replace the
root before entry and independently while the real commit is held: preserve the owning staged
result, reject successor writes/cleanup and emit the branch-move warning. Spy directly on
`trackTakeCommit`: neither refused entry may register, even when downstream outcome filtering
would hide that error. Remove each caller's ownership conjunct separately and require its own
spy assertion to fail. Clear refs, then finalize again: no second gesture counts. Pair a genuine
closure, legacy null witness and a landed sibling with a refused sibling; capture authority
before clearing refs, retain it across every queued wait, and distinguish refused resume from
success that settled just before replacement.

### 2026-10-27 — a retired audio terminal cannot borrow a successor opening (issue #5517)

The scheduler callback from `4f410257b212` lacked root authority; PR #4270 (`9a0cbea8d62b`) added same-ID failure cleanup and PR #4564 (`40c5218228c5`) added asynchronous commit cleanup. PR #5373 explicitly deferred these scheduler windows. Historical review dispatch and tier are unknown. Capture the public root identity at each punch opening, before callback registration, and retain that opening through success, failure, commit wait and catch. Guard before caching media, reading a same-ID live clip or discarding it.

Replace the root while an audio capture is open, retaining copied provisional state. Settle both stale success and stale failure, then reject a held commit after replacement: the successor must remain exact and no notice may falsely claim it discarded the take. On the same root, real success must commit once and genuine failure must retire its own provisional state. Open a later punch on the replacement root while the prior callback remains pending; only the later terminal may attach media and history. Preserve separate armed-input callbacks. Settled capture promises, including refusals, retain Transport's existing lifecycle count semantics; that count alone is never proof of a landed take.

PR #4564 (`40c5218228c5`) also introduced the manual audio terminal's missing-clip append escape (#5289). PR #5373 (`eecc1c5a8457`) fenced that opening, but immediate-flush and direct-root-replacement fixtures did not prove the real branch transition. Drive actual Stop with an explicitly held recorder terminal: a real switch must remain on the outgoing root until its take and Command entry settle, then save that branch and clear incoming Undo. A real fork can install its copied root while the old flush is held; settle both old success and old failure and preserve that successor's same-ID provisional clip, takes, media and history exactly. Pair actual same-owner completion and failure, known PCM through the real cache, and real Undo/Redo. Make the captured-root predicate always true and require both stale-terminal cases to fail. Historical reviewer prompts and tiers remain unverified; the missing stance was recording-owner lifetime across the actual branch transition.

### Deferred sensitivity must redraw the current clip's markers

Commit `33a3549990c5ce2234e22bf48f3d5758711e2b56` introduced an Elastic panel snapshot that stayed stale after deferred detection updated the owner store. No associated introducing PR or private review prompt or tier is established. Change sensitivity on varied-pulse audio, await the actual detection and owner projection, and require count, drawing and marker hit-testing to update without an incidental pointer refresh. Switch clips and check the current clip's projection, retained lock, unrelated clip and PCM. A subscription rollback must fail the real-store regression; this does not establish Worker or performance acceptance.

### Debounced Elastic gestures retain their displayed owner

The initial Elastic target mismatch in `33a3549990c5ce2234e22bf48f3d5758711e2b56` was hidden by explicitly opening every sensitivity fixture. No associated introducing PR or private review prompt, stance or tier is established. Hold the real debounce across selection A→B→A, explicit editor close/reopen, source replacement and same-ID root replacement. The old gesture must leave native rows and PCM exact, settle callers and release listeners; only a fresh gesture may act on the new owner. An unrelated selection must not override an explicitly opened target. Removing pending-owner invalidation must fail real raw-state controls, not merely a cancellation flag.

### 2026-10-26 — roll admission waited after the shared clock projection (introduced by PR #5453)

PR #5453 added `material.prepare` to every native backend apply. The live session computes its
rolling join position before calling `rollNativeTransport`, whose second `backend.apply` awaits
material owner/lease preparation before sending `set-transport` to native IPC. That preparation
also runs for a transport command with no clip PCM, so the clock gap is shared by the ordinary
no-NAM path in source; no no-NAM runtime failure was observed. PR #4020's projection remains
necessary for an already-rolling re-arm, as the adjacent #4089 lesson records.

In Alpha's hosted run `40258854873`, Unit 1 job `121366976610`, the actual-model-drain cases
failed at `maps` and `roll-material` because the NAM strip was already claimed while those
checkpoints were held. At `roll-position`, Web Audio's anchor advanced from 10 to 10.4 while
preparation was held; the sent position stayed at 2.5 instead of the expected 2.9. The
`roll-admission` positive control passed. These results establish the NAM RED case, not a no-NAM
runtime failure or live audibility. The public #5453 review record has four draws covering lease
generation, admission capacity, callback retirement, and project repair preservation; it has no
clock-handoff draw. The private historical prompts are unavailable.

Blind spot: the reviewer checked asynchronous lease safety and capacity but missed that the
position is consumed by a second apply with its own await after the position snapshot. A first
topology apply's clock projection does not cover later awaits in the roll apply.

Probe: hold roll material preparation after maps and MIDI are armed, advance the anchored Web
Audio clock from 10 to 10.4, then require the `set-transport` position to be refreshed to 2.9
after every pre-IPC await. For NAM, keep Web Audio sounding through model readback and all
material/bank awaits; validate and claim the matching admission, then close the actual rebound
strip gate in the same turn that constructs the refreshed command immediately before roll IPC.
Do not wait for the roll reply to gate. Keep the no-NAM source-level exposure distinct from a
runtime RED claim. This probe establishes ordering and admission, not live hardware audibility.

### 2026-10-26 — a deferred seek finalized into a successor transport (introduced by PR #305; repaired by PR #5374)

PR #305 (`b077ef6d34c7fc72bf3907a55bcaa7d7102a1584`) moved seek finalization behind the recording-flush promise while retaining only the pre-wait `wasPlaying` snapshot. During that wait, Stop→Play or Stop→Record can install a successor scheduler; the old finalizer can then stop that scheduler, write its stale seek target, or restart against successor state. Checking live `isPlaying` only gates restart; it does not establish ownership. Commit `983371455c147465033d6ac9ccd27706cc2210fa` later relocated the path into `executePlayheadSeek.ts` without introducing the race. PR #5374 (`ddceec4283b3715f267773b33bccfc21c3778e0f`) added the scheduler-generation ownership check before deferred side effects. The available public history does not contain the private reviewer prompts, so the exact missed stance or reviewer responsibility cannot be established.

Probe: through the real seek/transport coordinator, hold a controlled promise returned at the `stopActiveRecording` boundary after a playing, recording seek is admitted. While it is held, exercise Stop→Play and Stop→Record, then resolve and reject the promise. Require the successor worker identity, generation, epoch, transport state, and position to remain intact; on rejection, require the original error to remain reported. Remove the generation-ownership guard and require both successor cases to fail. This controlled scheduler probe tests deferred ownership; it does not establish real capture, PCM flushing, browser behavior, or hardware audibility.

### 2026-10-27 — dense loop-off inherited a linear window that replenished after its frames (introduced by PR #3912)

PR #3912 (`cb8a0c81fc`) admitted a capacity-sized linear prefix but kept its spent entries until
more than three seconds into playback. A 1200-pair, three-second phrase filled the 2048-entry
store; the remaining 352 events arrived only after their frames. Loop-window work in #5346
exposed the same path by disabling looping near the start. The original public review checked
prefix limits, refusal bookkeeping and trail counts without rendering the unadmitted suffix.
Private historical dispatches are unavailable, so the exact reviewer prompt is unverified.

Blind spot: capacity-safe admission does not establish timely delivery. A lifecycle stance must
walk dense loop-on to loop-off at the start and near-start, then seek and edit-rearm in the
resulting linear mode. Drive the real writer against a persistent store and render through the
entire phrase; require every expected event identity before its frame, bounded residency and no
callback overflow. Carry a distant real off and a same-key reattack through those transitions,
without replaying the old onset. Restore the linear prefix/three-second-clear path and require
the suffix assertions to fail. Model host queue admission separately from callback application:
a later note-store refusal leaves preceding clears applied and cannot be retried from an
already-applied host response. Native output peaks supplement this probe; they cannot count all
attacks/releases or establish zero callback refusals when the wire omits those counters.

### 2026-10-27 — device deltas assumed live eligibility meant an initialized strip (introduced by PR #2083)

PR #2083 made device edits require an exact live before-chain. MIDI import publishes a track with its default Synth after boot's strip projection, so a lawful Remove Synth before first Play commits project truth and then fails against an absent strip. Its public review caught project-only folders but did not cover an uninitialized live-eligible MIDI track; historical private prompts, models and tiers are unavailable. Play/Stop warming masked the missing admission. Undo also has to change the existing live chain, rather than send an initialization snapshot that can only accept an already matching strip.

Probe the real import, Command/CRDT/history and engine boundary with a completed import, an actually absent strip and no Play gesture. Require clean removal, exact authoritative final topology, and identity-preserving Undo/Redo. Exercise cold add/remove/reorder and grouped final-chain composition; refuse an existing mismatched strip, stale or unrelated project divergence and duplicate ownership. Inject initialization rejection and require committed failure with no later parameter writes. Revert the missing-strip admission and require the cold Command regression to fail. UI admission must require the Remove Synth control unconditionally and click it before first Play.

### 2026-10-28 — a busy automation pump retained an edit without sending its successor (introduced by PR #5461)

PR #5461 observed a newer lane, VCA or solo projection when a native batch was in flight, then returned. The predecessor's completion released its in-flight marker but arranged no follow-up; the edit reached the backend only if a later playhead poll happened. The existing real-store pending case settled the batch before asking for another pump. Public review covered queue and gain repairs, but its final approval reported unrun mutation probes; private stance prompts and tiers are unavailable, so no precise historical stance is inferred.

Hold an earlier backend apply after it has captured a real-store batch. Edit a lane, VCA or solo state and invoke one same-pass pump while that apply remains unanswered. Require no overlap, then settle the predecessor **without another pump** and require one serialized successor with the new Hold or control and untouched unrelated queue. Coalesce later matching snapshots; reject an old pass or backend after seek, disarm or replacement, and preserve refusal and batch-fence accounting. Removing only the completion follow-up must fail this case. This proves scheduled submission after settlement, not a wall-clock audio deadline while the backend is blocked.

### 2026-10-30 — first paint concealed that bootstrap effects had already started

PR #3356 (`26c6a7fe7d3374572f42510ac9accf8ff293a420`) introduced first paint before the initial
App import settled while bootstrap remained in the parallel startup path. The failed reload
contained capability and BrowserAi initialization before App rejection, so an empty shell or absent
controls did not mean the runtime was pristine. The App rejection defect reached main; the
historical private reviewer prompt and tier are unknown. The separate legacy desktop-test ordering
failure during #5876 repair was caught before merge.

Hold the actual initial App import after first paint. Before release, observe the real bootstrap
evaluation/effect boundary. If App fulfillment owns bootstrap, require effects initiated by bootstrap
to remain absent until release. After release, require actual App render issuance and bootstrap observation. Do not infer
quiescence from missing UI/capability markers, fixed microtask counts, or an unrelated hung-import
case; preserve the distinct cold-stylesheet lesson in test-validity.

### 2026-10-30 — early scheduler callbacks published future deadlines (PR #955)

PR #955 (`9273fb830b42e102a67802ffdb46d55cd10663d6`) introduced the worker deadline
advance and the receiver's `sentAtMs >= scheduledAtMs` admission. PR #956
(`74616a080d0e400b8b9ed44a5361a57b21ec933a`) retained that relation while validating
message timing. PR #955 has no public reviews; historical private prompts and tiers are
unknown. The missed input was a callback before the next deadline: forcing one elapsed
slot published that future deadline and advanced it, so a sustained early phase could
keep every subsequent payload outside the receiver's contract.

Drive the actual worker module with controlled early clock reads at the initial deadline
and after missed slots. Require no premature emission or sequence/deadline advance, then
continued admissible ticks on the unchanged due-slot grid. Retain exact, late, missed-slot,
restart and stop controls, and keep the receiver's timestamp and generation guards strict.
Removing only the early-callback guard must fail the named worker spec. Controlled clock
inputs prove this producer contract; they do not attribute the separately observed #5889
browser stall, whose raw worker messages were not retained.
