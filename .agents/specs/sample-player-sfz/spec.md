---
type: spec
id: SPEC-sample-player-sfz
title: SFZ sample-player instrument
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# SFZ sample-player instrument

## Intent

A multisample instrument device that loads SFZ files, maps regions across key and velocity,
and plays them with bounded polyphony, ADSR envelopes, and loop modes through an
AudioWorklet voice engine.

## Non-goals

- An SFZ authoring / mapping editor (the instrument consumes SFZ, it does not create it).
- Disk-streaming of very large libraries in v1 (full-RAM load only).
- Convolution / built-in effects beyond per-region gain, pitch, and filter.
- Round-robin and random sample selection in v1 (see open question).

## Requirements

### AC-001 — SFZ parsing

Loading an SFZ file must populate a region model honouring `<global>`/`<group>`/`<region>`
opcode inheritance for the supported opcode subset.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-002 — Region resolution by key and velocity

A note at a given pitch and velocity must select the region(s) whose `lokey`/`hikey` and
`lovel`/`hivel` ranges contain it.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-003 — Deterministic voice stealing

Exceeding the configured polyphony must steal voices by a deterministic policy, producing
identical voice allocation across runs of the same note sequence.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-004 — ADSR envelope control

Each voice's amplitude must follow its region's ADSR, reaching the release stage on
note-off and silence at the end of release.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-005 — Click-free looping

A region in a loop mode must repeat its loop region without an audible seam.

Verify with: `manual` — sustain a looped region; no periodic click at the loop point

### AC-006 — Graceful missing-sample handling

Loading an SFZ whose region references a missing sample must load the instrument with that
region silent and the missing file surfaced — the load must not fail.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-007 — Instrument persistence

Saving and reloading a project must restore the loaded SFZ reference and per-instrument
settings.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-008 — Instrument module isolation

The instrument must not import internals of other modules.

Verify with: `pnpm deps:validate`

### AC-009 — `.zip` bundle loading

Dropping a `.zip` bundle that contains an `.sfz` file plus its samples must load the
instrument by treating the bundle as a virtual filesystem, resolving each region's `sample=`
reference inside the bundle exactly as for a loose `.sfz`.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-010 — Bundle entry-name sanitisation

Loading a `.zip` bundle must reject entry names that escape the bundle root — names with `..`
path segments or absolute paths — before any entry is decoded, so a crafted bundle cannot
reach outside the virtual filesystem.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-011 — Exclusive-group voice silencing (`group` / `off_by`)

Triggering a region must silence every sounding voice whose `group` equals the new region's
`off_by` value, so SFZ choke groups (e.g. a closed hi-hat cutting the open hi-hat) cut
correctly.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-012 — No allocation on the audio render path

The worklet's `process()` must not allocate: all voices, filter states, and temp buffers are
pre-allocated, the render path mutates no array (only index writes into preallocated typed
arrays), and the MIDI event queue is drained at most once per 128-sample render quantum.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-013 — Per-region 2-pole filter

Each region must support a 2-pole filter selected by `fil_type` — `lpf_2p` (low-pass) or
`hpf_2p` (high-pass), or off — applied per voice from the region's `cutoff` (cutoff
frequency in Hz) and `resonance` opcodes, so a voice's output is shaped by its region's
filter when one is declared. Each voice carries its own filter state (a biquad state) so
voices do not share filter memory. The `SfzRegion` model exposes `filType` (`'off' |
'lpf_2p' | 'hpf_2p'`), `cutoffHz`, and `resonance`.

Verify with: `pnpm test:run -- SamplePlayer`

### AC-014 — Drop a loose `.sfz` on a MIDI track creates a pre-loaded `sfz-player` device

Dropping a loose `.sfz` file onto a MIDI track's header must load and attach a new
`sfz-player` device to that track's device chain, pre-loaded with the SFZ's regions and
samples, ready to play MIDI without further user action. (This is the loose-`.sfz`
counterpart to AC-009's `.zip`-bundle path.)

Verify with: `pnpm test:run -- SamplePlayer`

### AC-015 — End-to-end drop → arm → play produces non-zero audio

Dropping a fixture `.sfz` on a MIDI track, arming the track, and playing a MIDI clip must
produce non-zero audio output through the existing audio graph — exercising the full
drop → attach → play path end to end.

Verify with: `pnpm test:run -- sfz-player.e2e` (Playwright E2E: drop a fixture `.sfz` on a
MIDI track, arm and play a MIDI clip, assert audio output is non-zero)

### AC-016 — Device panel with region map and global controls

The `sfz-player` device must surface a device panel (`SfzPlayerPanel`) that shows the loaded
instrument name and short patch hash, a region-map visualisation (x = MIDI note, y =
velocity, one coloured rectangle per region, hovering a region shows its details), global
controls (Master Volume, Master Tune, Filter Cutoff Offset, and a Voices-Playing
indicator), and a loading progress bar while samples decode.

Verify with: `manual` — load a multi-region patch; the panel renders the region map, the
four global controls, and a progress bar during decode

### AC-017 — Browser and command-palette load/unload entries

The Sample-Library browser must expose an "SFZ" category whose entries can be dragged onto a
track to create a pre-loaded `sfz-player` device, and the Command Palette must offer "SFZ:
Load Patch…" (opens a file picker) and "SFZ: Unload Current Patch" entries.

Verify with: `manual` — the browser shows an SFZ category with drag-to-track; the command
palette lists the load and unload entries

### AC-018 — Global per-instrument params and patch unload

The instrument must support adjusting per-instrument global parameters — `masterVolume`,
`masterTune`, and `filterCutoffOffset` — via `setSfzParam(deviceId, name, value)`, and must
support unloading the current patch from a device (the `unloadSfzPatch` action).

Verify with: `pnpm test:run -- SamplePlayer`

### AC-019 — Patch load-time budget

A typical factory-size SFZ (50–200 samples) must load in well under a second; loading a
200-sample patch on the declared baseline machine must complete in under 3 seconds wall-clock.

Verify with: `pnpm test:run -- SamplePlayer` (perf test: load a 200-sample patch, assert
wall-clock < 3 s)

### AC-020 — Trigger modes

Each region must honour its `trigger` opcode — `attack` (the default, sound on note-on),
`release` (sound on note-off), `first` (sound only when no other note of the group is held),
and `legato` (sound only when another note of the group is already held) — so release
triggers and legato handling play as the SFZ declares. The `SfzRegion` model exposes
`trigger` (`'attack' | 'release' | 'first' | 'legato'`).

Verify with: `pnpm test:run -- SamplePlayer`

### AC-021 — Unknown opcodes warn and continue

Loading an SFZ that contains an unsupported opcode must emit an `UNSUPPORTED_OPCODE` warning
(`warn: true`) carrying the opcode name, surface that warning exactly once per patch per
opcode, and continue loading the rest of the patch rather than failing. (Distinct from
AC-006's missing-sample handling.)

Verify with: `pnpm test:run -- SamplePlayer`

### AC-022 — Per-region pitch, gain, and pan shaping

Each voice must apply its region's pitch and amplitude opcodes when it sounds: pitch from
`pitch_keycenter` (playback rate so the note plays at its mapped pitch) combined with `tune`
(cents) and `transpose` (semitones); amplitude from `volume` (dB) and `pan`; and
velocity-to-amplitude scaling from `amp_veltrack` (0..100), so a note plays at the pitch,
level, and stereo position the SFZ declares for its region. The `SfzRegion` model exposes
`pitchKeyCenter`, `tuneCents`, `transposeSemis`, `volumeDb`, `pan`, and `ampVeltrack`.

Verify with: `pnpm test:run -- SamplePlayer`

## Open questions

- [ ] Q-001 — Which SFZ opcode subset is v1 (full coverage is large)?
- [ ] Q-002 — Disk-streaming vs full-RAM threshold for large multisample libraries.
- [ ] Q-003 — Round-robin / random sample selection in v1?
- [ ] Q-004 — SFZ scope reduction (product-owner call). Intake `implementation-gaps.md`
  §"SFZ" scoped a native Rust `daw-sfz` crate (or inside `daw-dsp`), `creek`-backed disk
  streaming, an OPFS-backed streaming path for the web build (2 GB pack → first playable
  note ≤500 ms), and a per-file opcode compatibility-report generator
  (supported/partial/unsupported). This spec is JS/TS, AudioWorklet, in-RAM-only (full-RAM
  load; disk-streaming and round-robin already deferred behind Q-002/Q-003), with no Rust
  crate, no OPFS streaming, and no compatibility report. Is the JS in-RAM reduction an
  accepted cut, or should the Rust/creek/OPFS/compat-report plan be reopened? Not decided
  here — product-owner call.

## Affected areas

- `src/modules/SamplePlayer/` (new instrument device + view)
- the SFZ parser service and sample-loading I/O
- the AudioWorklet voice engine and shared voice-state buffer
- the project model for instrument persistence

## Dropped from sources

- SFZ authoring/mapping editor — consume-only in v1; a separate editor scope.
- Disk-streaming of large libraries — deferred behind Q-002.
- Round-robin / random selection — deferred behind Q-003.
- Built-in effects beyond per-region gain/pitch/filter — out of scope.
- Loop-crossfade mechanism — the source (`specs/missing/sample-player-sfz.md`, Risks)
  recommended defaulting to a 128-sample automatic crossfade at every loop boundary
  regardless of opcode, because the SFZ `loop_crossfade` opcode is deferred to v2 and a hard
  loop transition can click. AC-005 keeps the click-free *outcome* as the requirement and
  leaves this specific crossfade length to the implementation rather than prescribing it.
