# crates/daw-engine — Agent Guidelines

Real-time audio processing graph, CPAL/WASAPI device drivers, audio thread priority management, and lock-free host communication.

## Domain Ownership

- Owns OS audio device streams (CPAL / Windows IAudioClient3/WASAPI; ADR 0027), audio callback loops, and real-time graph dispatch.
- Owns lock-free SPSC communication rings (`rtrb`, `triple_buffer`) between control and audio threads.
- Does not own plugin binary discovery or scanning (`daw-plugin-host`), file decoding (`daw-io`), or frontend WebAudio graphs (`src/modules/AudioEngine`).

## Real-Time Invariants (Hard)

- **Zero Allocation & Zero Locks**: Audio render callbacks (`audio_thread.rs`) must execute with zero heap allocations, zero mutex locks, and zero blocking syscalls (`assert_no_alloc` in debug tests).
- **Headroom over Latency**: SPSC ring buffers must decouple the audio callback from asynchronous command processing, so control-thread work never blocks the callback and no queued command is silently dropped.
- **One clock**: every plugin the engine hosts runs inline on the audio callback, inside the chain that holds it. A hosted instance is registered homed detached — releasing it from a chain returns it to a placement that runs nowhere — and nothing renders it on a second cadence.
- **Teardown Order**: Audio streams must stop and drain before dropping downstream DSP nodes or CLAP plugin instances.
- **A note reaches its instrument on the sample it was written for**: a scheduled note reaches the
  instrument on the sample that renders its timeline frame, in the block that renders it; an
  immediate note reaches it at the head of the next block, because a note played live has no
  timeline position to stamp it against; and a note behind the playhead when it is scheduled is
  stored and counted late, never fired out of order. Quantising a scheduled note to a block boundary
  puts it up to a buffer away from where it was written, and firing a late one at the head of the
  next block puts it ahead of everything already sounding — both are audible, and neither is a
  timing a DAW is allowed to invent.
- **Events reach a plugin in non-decreasing time**: every event a device is handed in one call is
  stamped no earlier than the one before it, because that is what CLAP requires of a host and what a
  VST3 processor reads its sample offsets as. That order is a property of the block a device is
  handed, so it is the block's own frame of reference the stamps are measured in: a chain device is
  handed one span at a time and its stamps run from the span's first frame, while a master insert
  drains once per callback over the whole buffer and its stamps run from the callback's. Notes
  scheduled for one frame reach the instrument in the order their producers stored them, which is
  the only order a producer can express for a pair that sounds on one sample.
- **A stop, a locate, a loop wrap, and a clear release every note the store has sounded**: each of
  them leaves the frame a sounding note's note-off was written for behind — the playhead stands
  still, moves away from it, turns back before reaching it, or the clear takes that frame out of the
  arrangement altogether — so nothing is going to render that note-off, and the instrument would
  hold the key until something unrelated happened to release it. Only a note-off the clear removes
  owes a release: a note-on it removes either never sounded, or sounded and still has the note-off
  its producer wrote. The release is a note-off at the head of whatever renders next, on the seam
  for a loop wrap. A note played live is not released: it has no timeline position and no scheduled
  note-off, so a key the player is holding stays held exactly as it does on hardware.
- **A release the event buffer refuses leaves its note held**: the key is down whether or not the
  note-off found room, so the note stays in the sounding set and the next stop, locate, wrap or
  clear owes it again. Dropping the record along with the event turns one refused message into a
  key nothing can ever lift, which is worse than releasing late.

## Plugin Delay Compensation

- **Alignment at every summing point**: everything meeting at one point — a track output and its
  siblings at the master, the sends landing on a bus, a bus feeding another bus — arrives having
  waited the same number of frames. A route's hold is the summing point's deepest arrival minus its
  own, and a bus's arrival carries into the point it sums at, so hops add up.
- **A track input is a summing point too**: a track fed by other tracks or buses is a group, and
  what lands on its input has waited the depth of that input like any other contributor. The group's
  own clips are the side that waits, held back to meet them, so a group never leads the tracks
  feeding it. Live input monitored through that track is not held: hearing yourself late is the one
  alignment a DAW must not make.
- **A generator on a strip waits with that strip's own material**: an instrument produces at zero
  wherever it sits, so a generator is held before its output joins the chain signal, and meets the
  routed-in material exactly as a clip does. Its material is summed at its own place in the chain,
  where the signal has already taken the latency of the devices ahead of it, so the hold is the
  depth of the strip's input plus that declared prefix — aimed at the input's depth alone, an
  instrument behind a latent device would lead the very route it was placed to meet. That prefix
  counts every entry ahead of the instrument, generators included, because a latent instrument
  delays the signal passing through it exactly as a latent effect does. The hold is a
  line built control-side and shipped with the splice that places the device, and it takes its pass
  on every block the chain visits that device, bypassed or not — the silence a bypassed instrument
  is handed is what drains the hold on schedule. Every splice ships a fresh silent line and the
  device installs it, so a generator arriving on a strip owes its hold's worth of silence there
  without any line ever being cleared in place.
- **A latent generator holds the strip material passing through it**: an instrument that declares
  latency emits its material that many frames after the events it was asked for, so everything else
  on the strip leaves that device that late as well — the strip's own clips and whatever is routed
  into it alike. It is the same hold a latent effect takes, on the same dry line, taken on every
  block the chain visits the device and bypassed or not, because bypass keeps latency. That hold is
  what makes the summed declared latency of a chain the arrival its strip really has: without it a
  strip carrying an instrument would deliver its material ahead of the figure the graph computed
  for it, and ahead of every sibling the graph held back to meet that figure. The generator's own
  material is not that hold's business — it is produced into the scratch the chain sums in, behind
  the generator's own input hold — so the dry line takes exactly one pass per block, over the chain
  signal and never over that scratch.
- **Bypass keeps latency**: a bypassed latent effect runs its dry line in place of processing. A
  latent generator's dry line runs over the pass-through on every block regardless of bypass, as the
  bullet above states, alongside the generator's own pass into its scratch — bypass only withholds
  that pass, never the dry line. Either way, bypass never triggers a recompensation. Auditioning one
  plugin must not move every other route in the project — the common professional convention, and
  the reason the dry line is built with the latency rather than with the device.
- **Every line is written on every block it renders**: a route line and a dry line alike take
  exactly one pass per block — read-and-write while they hold, write-only otherwise. A route line
  holding nothing is fed rather than skipped, and a dry line is fed on every block the chain visits
  its device, including the blocks a shadowed or otherwise skipped device is passed over. So a line
  always holds the last frames of the signal its route carries, a change of hold is a read-offset
  jump into audio that is already current, and neither a re-aiming nor a bypass can open a hole of
  silence or replay audio from an earlier part of the session.
- **Every line is sized at the ceiling and re-aimed in place**: a route line and a dry line alike
  are built to hold anything the ceiling admits, so no change of figure ever needs a new ring. A
  device's declared latency moving is therefore a read-offset jump into audio that line is already
  holding, exactly like a recompensation — one bounded repeat or skip of the difference, never a
  hold's worth of silence. Swapping a fresh ring in would empty the line the graph has been keeping
  current, which is the very thing the rule above exists to prevent.
- **A detached device's line restarts from silence**: a device can be left holding no placement at
  all — the strip it sat on removed under it, or a hosted plugin taken off the strip that
  borrowed it — and nothing then feeds or reads its dry line. That is the one break in the rule
  above, so it is the one place the dry line is cleared, and it stays silent until a chain
  takes the device again and starts feeding it. The clear is taken on every transition into
  detachment, bounded by the latency declared then. A generator's input hold is never cleared
  in place: the splice that places the device ships a fresh silent line and installs it, so
  the hold a detached generator still owns is replaced, not restarted.
- **A hold is only as deep as the history behind the write head**: a device goes on declaring while
  it waits, and a figure can also arrive a block after a strip has taken it back but before that
  strip has fed its line. Either way a hold reaching further back than the last restart lands on
  slots that still carry the audio of the strip the device left, so a line owes silence for any hold
  deeper than the frames fed since that restart — wherever its device sits when the figure arrives.
  The line itself owns that rule, so no caller can aim one past its own history; a route line and a
  dry line fed since it was built are covered to their capacity and never pay it.
- **A ceiling, and a count**: compensation past the ceiling clamps and is counted in the timeline's
  real-time diagnostics, alongside the deepest arrival the graph was asked for. The count covers
  every line the ceiling cut short — a route line, and the dry line of a device declaring past it,
  which a strip aligning every route perfectly still runs. Only a placed device runs such a line: a
  detached one is fed and read by nothing and adds nothing to any summing point's depth, so its
  declaration is counted once a chain takes it and not before. A hold that could not be taken is
  reported, never silently misaligned.
- **Lines are built control-side**: every delay line reaches the callback owning its buffers, and one
  the callback declines or gives up leaves over the ADR 0020 retirement route. A latency figure and
  a line to hold a bypassed pass at it travel on one command, so no caller can publish one without
  the other; the control thread cannot see whether the device already runs a line, so it ships one
  whenever the figure is non-zero and the callback returns whichever is spare.
- **What dirties compensation**: a change to declared latency, to the device chains, or to the shape
  of the routing graph. Gain, pan, mute, solo, bypass and transport do not.

## Verification

```bash
cargo test --package daw-engine
```
