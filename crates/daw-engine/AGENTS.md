# crates/daw-engine — Agent Guidelines

Real-time audio processing graph, CPAL/WASAPI device drivers, audio thread priority management, and lock-free host communication.

## Domain Ownership

- Owns OS audio device streams (CPAL / Windows IAudioClient3/WASAPI; ADR 0027), audio callback loops, and real-time graph dispatch.
- Owns lock-free SPSC communication rings (`rtrb`, `triple_buffer`) between control and audio threads.
- Does not own plugin binary discovery or scanning (`daw-plugin-host`), file decoding (`daw-io`), or frontend WebAudio graphs (`src/modules/AudioEngine`).

## Real-Time Invariants (Hard)

- **Zero Allocation & Zero Locks**: Audio render callbacks (`audio_thread.rs`) must execute with zero heap allocations, zero mutex locks, and zero blocking syscalls (`assert_no_alloc` in debug tests).
- **Headroom over Latency**: SPSC ring buffers must decouple the audio callback from asynchronous command processing without dropping blocks before native plugins process them.
- **Teardown Order**: Audio streams must stop and drain before dropping downstream DSP nodes or CLAP plugin instances.

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
- **Bypass keeps latency**: a bypassed latent device runs its dry line instead of processing, and
  bypass never triggers a recompensation. Auditioning one plugin must not move every other route in
  the project — the common professional convention, and the reason the dry line is built with the
  latency rather than with the device.
- **Every line is written on every block it renders**: a route line and a dry line alike take
  exactly one pass per block — read-and-write while they hold, write-only otherwise. A route line
  holding nothing is fed rather than skipped, and a dry line is fed on every block the chain visits
  its device, including the blocks a shadowed or otherwise skipped device is passed over. So a line
  always holds the last frames of the signal its route carries, a change of hold is a read-offset
  jump into audio that is already current, and neither a re-aiming nor a bypass can open a hole of
  silence or replay audio from an earlier part of the session.
- **A detached device's line restarts from silence**: the strip a device sat on can be removed under
  it, and nothing then feeds or reads its line. That is the one break in the rule above, so it is
  the one place a line is cleared — bounded by the declared latency, at the detach — and it stays
  silent until a chain takes the device again and starts feeding it.
- **A ceiling, and a count**: compensation past the ceiling clamps and is counted in the timeline's
  real-time diagnostics, alongside the deepest arrival the graph was asked for. A route that could
  not be aligned is reported, never silently misaligned.
- **Lines are built control-side**: every delay line reaches the callback owning its buffers, and one
  the callback replaces or gives up leaves over the ADR 0020 retirement route. A latency figure and
  the line sized for it travel on one command, so no caller can publish one without the other.
- **What dirties compensation**: a change to declared latency, to the device chains, or to the shape
  of the routing graph. Gain, pan, mute, solo, bypass and transport do not.

## Verification

```bash
cargo test --package daw-engine
```
