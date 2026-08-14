---
type: spec
id: SPEC-ableton-link-sync
title: Ableton Link clock sync
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Ableton Link clock sync

## Intent

Integrate Ableton Link as a selectable transport sync source so Sourdaw tempo and beat
phase track Link peers on the local network, isolated behind a crate feature flag so the
GPL-licensed dependency does not leak into builds that cannot accept it.

## Non-goals

- Peer-to-peer collaborative transport sync over WebRTC (see `collaboration-transport-sync`).
- MIDI clock generation (see `midi-engine-primitives`).
- Non-desktop builds (Link is a desktop/native feature).

## Requirements

### AC-001 — Tempo tracks a Link peer

With Link enabled and one peer on the subnet, Sourdaw transport tempo must track the
peer's tempo within ≤0.5 BPM of drift within 2 s of a remote tempo change.

Verify with: `manual` — change tempo on an Ableton Live Link peer; confirm Sourdaw follows within 2 s

### AC-002 — Quantized start alignment

Starting playback on a peer while Sourdaw is armed to Link must start Sourdaw on the
next quantum boundary within ≤1 ms of the Link beat clock.

Verify with: `manual` — start a Link peer and confirm Sourdaw starts on the next quantum within ≤1 ms (MIDI-clock tick alignment)

### AC-003 — Clean disable

Disabling Link must return the transport to the internal clock within ≤1 block without
glitching audio.

Verify with: `pnpm cargo:test -- -p daw-engine link_disable_clean`

### AC-004 — Feature-flag isolation

Building without the `link` feature must not pull the Link dependency into the tree.

Verify with: `cargo tree --no-default-features`

### AC-005 — UI hides the Link option without the feature

The UI must hide the Link option when the `link` feature is absent.

Verify with: `cargo tree --no-default-features`

## Open questions

- [ ] (non-blocking) Document the GPL licensing implications in the third-party licensing
  doc — confirm placement.

## Affected areas

- `crates/daw-engine/` (rusty_link behind `link` feature), Tauri bridge channel
- transport sync-source selector UI

## Dropped from sources

- None — this spec scopes the §7.7 items directly.
