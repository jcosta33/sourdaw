# Review stance: session lifecycle

Dispatch guidance for the stance that attacks a change to a runtime session's lifecycle — anything
that starts, stops, parks, replaces or disposes a long-lived runtime the app holds on behalf of a
user-facing mode: the native live graph session, the playhead scheduler, the playhead feed, a
recording session, a plugin host instance, a collaboration transport. Per the Review section of
`AGENTS.md`, an escape — a defect that reached `main` which this stance should have caught — is
recorded here as a lesson, and every future dispatch of this stance carries this file's lessons.
Lessons state the escape, the blind spot, and the probe that would have caught it. Keep each lesson
short enough to paste into a dispatch.

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
