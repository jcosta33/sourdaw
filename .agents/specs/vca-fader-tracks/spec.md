---
type: spec
id: SPEC-vca-fader-tracks
title: VCA fader tracks
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# VCA fader tracks

## Intent

Add VCA fader tracks as a first-class mixer track type: a channel strip that remote-controls the
gain of many assigned tracks without audio passing through it, with correct post-fader send
scaling. This replaces the current `VcaGroup`-as-owner mechanism, where group gain is folded into
each track's effective engine gain (which mis-models pre-fader sends and cannot be inspected
independently).

## Non-goals

- The existing `vcaGroupId` group-assignment data on regular tracks — reused, not removed.
- Bus/group summing — a VCA scales gain in-place; it does not sum audio.

## Requirements

### AC-001 — VCA is a distinct track kind

`TrackKind` must include `'vca'`.

Verify with: `pnpm test:run -- AudioEngine vcaTrackMigration`

### AC-002 — No audio passes through the VCA strip

A VCA track must have no input node, device chain, output routing, or meter feed in `AudioEngine`;
bypassing it (unity gain) must leave the render bit-identical to removing it.

Verify with: `pnpm cargo:test -- -p daw-engine vca_no_audio_path`

### AC-003 — Post-fader sends scale by the VCA gain

The VCA multiplier must scale each assigned track's direct output and its post-fader sends, leave
pre-fader sends unscaled, and be applied at the send-routing stage rather than by mutating the
track's base gain.

Verify with: `pnpm cargo:test -- -p daw-engine vca_post_fader_send_scaling`

### AC-004 — Muting a VCA cascades to assigned tracks

Muting a VCA track must silence all assigned tracks without toggling their `muted` flags.

Verify with: `pnpm test:run -- AudioEngine vcaMuteSolo`

### AC-005 — Assignment selector lists VCA tracks and sets membership

The `TrackVcaSection.tsx` selector must list VCA tracks by name and set `vcaGroupId`.

Verify with: `pnpm test:run -- Workspace trackVcaSection`

### AC-006 — The VCA strip hides non-applicable controls

The VCA channel strip must render only name, color, fader with dB readout, mute, solo, and the
assigned-track list — no meters, clip lane, device slots, I/O selectors, or send list.

Verify with: `manual` — inspect a VCA strip and confirm meters/clip lane/devices/IO/sends are absent

### AC-007 — Creating a VCA track is a persisted, undoable object

Creating a VCA track must be a persisted, undoable project object.

Verify with: `pnpm test:run -- AudioEngine vcaTrackMigration`

### AC-008 — Legacy VcaGroup entries migrate 1:1

Legacy `VcaGroup` entries must migrate 1:1 idempotently with `vcaGroupId` references preserved.

Verify with: `pnpm test:run -- AudioEngine vcaTrackMigration`

### AC-009 — Soloing a VCA cascades to assigned tracks

Soloing a VCA track must solo all assigned tracks.

Verify with: `pnpm test:run -- AudioEngine vcaMuteSolo`

### AC-010 — Un-assigning from a muted VCA restores audibility

Un-assigning a track from a muted VCA must restore its audibility immediately.

Verify with: `pnpm test:run -- AudioEngine vcaMuteSolo`

### AC-011 — VCA inspector shows assigned tracks

A VCA track's inspector must show a read-only list of assigned tracks.

Verify with: `pnpm test:run -- Workspace trackVcaSection`

## Open questions

- [ ] (non-blocking) Should a VCA be able to control another VCA (nesting)? Proposed: defer to a follow-up.

## Affected areas

- `TrackKind` (`'vca'`), VCA track model + migration
- `applyVcaGains` reworked to apply the multiplier at send-routing, not base gain
- `AudioEngine` send-level routing; `TrackVcaSection.tsx`

## Dropped from sources

- VCA nesting — deferred.
