---
type: spec
id: SPEC-instrument-semantics
title: Negotiated instrument semantics
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Negotiated instrument semantics

## Intent

Treat devices and plugins as self-describing where possible: on load, discover and
display expressive capabilities (MPE, per-note pitch/pressure/slide), articulation
support, and a suggested editor profile, then offer a safe "adopt detected semantics"
flow. If discovery works it materially improves editing; if it fails, the session
degrades gracefully to generic control without confusing the user.

## Non-goals

- Articulation map authoring and keyswitch management (see `articulation-maps`).
- The expression model and editor views (see `performance-expression`).
- Cross-target portability mapping (see `expression-portability`) — it consumes these
  capability descriptors but is specified separately.
- The project-wide capabilities graph (see `chrome-first-capability`).

## Requirements

### AC-001 — Devices carry a capability descriptor

A device must expose a capability descriptor (MPE, per-note pitch/pressure/slide,
articulation-switching kind, drum-map flag, expression tier).

Verify with: `pnpm test:run -- deviceCapabilities`

### AC-002 — Built-in instruments register capabilities statically

Built-in instruments (e.g. Fermenter full-MPE, Levain keyswitch, Toaster drum-map,
GrandBoule per-note) must resolve their capabilities from a static registration table.

Verify with: `pnpm test:run -- builtinDeviceCapabilities`

### AC-003 — Editor adapts to declared capabilities

The piano-roll toolbar must show/hide expression-lane toggles based on the active
device's capabilities, and offer a drum-pad view for drum-mapped devices.

Verify with: `pnpm test:run -- PianoRollToolbar`

### AC-004 — Adopt-semantics prompt, never silent reconfigure

When a device declares capabilities that differ from the track's current setup, a
non-blocking Adopt Semantics prompt must appear once per device instance with Adopt /
Keep current / Never options.

Verify with: `pnpm test:run -- deviceSemanticsStore`

### AC-005 — Graceful degradation on discovery failure

When capability discovery returns nothing or fails, the session must fall back to
generic control with no prompt and no error.

Verify with: `pnpm test:run -- deviceCapabilities`

## Open questions

- [ ] (non-blocking) Live CLAP note-port/params discovery via the Rust host depends on
  the plugin-hosting work; static registration ships first. Confirm sequencing.
- [ ] (non-blocking) Is the "Never for this device" opt-out per device instance or per
  device type? Default: per instance.

## Affected areas

- `src/modules/Arrangement/models/Track.ts` (DeviceCapabilities), `services/` (registry)
- `src/modules/Arrangement/stores/` (deviceSemanticsStore), `useCases/loadDevice`
- `src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx`

## Dropped from sources

- MIDI-CI / Property Exchange profile negotiation over hardware (future-spec H) —
  deferred; v1 covers built-in static registration plus plugin descriptor introspection.
- User-authored semantics templates — deferred to a follow-up.
