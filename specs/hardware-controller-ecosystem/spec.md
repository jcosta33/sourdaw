---
type: spec
id: SPEC-hardware-controller-ecosystem
title: Hardware controller ecosystem
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Hardware controller ecosystem

## Intent

Build a controller profile and scripting ecosystem on top of the existing Web MIDI picker, MIDI
Learn, and MIDI preferences: auto-detecting controller profiles for popular hardware, a sandboxed
JavaScript/TypeScript scripting layer for third-party device scripts, and portable import/export
of custom mappings.

## Non-goals

- The base Web MIDI device selection, MIDI Learn, and preferences — already implemented.
- Server-side mapping distribution / marketplace — client-side only.

## Requirements

### AC-001 — Known controllers auto-load a profile

Connecting a recognized controller (Push, Launchpad, KeyStep, etc.) must auto-load its mapping
profile with visual mapping overlays, without manual MIDI Learn.

Verify with: `manual` — connect a known controller and confirm its profile loads and maps automatically

### AC-002 — Scripts run sandboxed and control parameters

The scripting API must run third-party JS/TS in a sandboxed Web Worker that can register mappings,
respond to MIDI/OSC, control parameters, and drive LED/display feedback — with no filesystem or
network access.

Verify with: `pnpm test:run -- HardwareController scriptSandbox`

### AC-003 — Mappings import and export as portable JSON

Custom device/macro mappings must import/export as a portable JSON format, client-side only.

Verify with: `pnpm test:run -- HardwareController mappingImportExport`

## Open questions

- [ ] (non-blocking) Minimum profile set for first release? Proposed: Push 2, Launchpad X, KeyStep.

## Affected areas

- new `HardwareController` module (profiles, scripting API, mapping management)
- builds on `MidiDevicePicker.tsx`, `midiLearnStore`, `MidiSection.tsx`

## Dropped from sources

- Mapping marketplace / distribution server — out of scope.
