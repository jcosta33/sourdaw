---
type: spec
id: SPEC-orchestra-daw-integration
title: Orchestra DAW integration and template system
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra DAW integration and template system

## Intent

Make Orchestra a first-class citizen in the DAW: each instrument loads in an
instrument slot, receives MIDI and outputs to the mixer with full parameter
automation, and an orchestral template system loads whole pre-routed, pre-panned
section sets in one action.

## Non-goals

- The piano-roll articulation lane and keyswitch management — owned by
  `SPEC-articulation-maps`.
- Running multiple Levain instances independently — owned by
  `SPEC-levain-multi-instance`.
- The instrument's own internal UI — owned by
  `SPEC-orchestra-progressive-disclosure-ux`.

## Requirements

### AC-001 — An instrument loads in a DAW instrument slot and plays MIDI

When an Orchestra instrument is added to a track's instrument slot, it must
receive that track's MIDI and output audio to the mixer.

Verify with: `pnpm test:run -- orchestraInstrumentSlot`

### AC-002 — All instrument parameters are host-automatable

When the host automates an Orchestra parameter, the instrument must expose it for
automation and respond to automation playback.

Verify with: `pnpm test:run -- orchestraParameterAutomation`

### AC-003 — A template loads a pre-routed, pre-panned section set

When an orchestral template (e.g. "String Orchestra") is loaded, it must
instantiate its instruments with their mixer routing, panning, and sends already
configured.

Verify with: `pnpm test:run -- orchestraTemplateLoad`

### AC-004 — Shared daw-dsp effects are available as per-instrument inserts

When inserting an effect on an Orchestra instrument, the shared `daw-dsp` effects
(EQ, compressor, reverb) must be usable as inserts.

Verify with: `pnpm test:run -- orchestraSharedInserts`

### AC-005 — DAW integration imports no other module's internals

When the integration code wires the instrument into the host, it must not import
another module's internals.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Multi-out routing (one output per mic position) — in this
  spec or a later multi-out spec shared with the mixer?
- [ ] (non-blocking) Does the full-orchestra template define track creation, or
  hand a manifest to the existing project/template system?

## Affected areas

- `src/modules/Levain/` (instrument-slot integration, parameter exposure)
- the project/template system that instantiates and routes section sets
- `src/modules/Mixer/` (routing and inserts for instrument output)

## Dropped from sources

- The articulation lane in the piano roll — owned by `SPEC-articulation-maps`;
  cross-referenced, not duplicated.
- An instrument-rack analog to drum racks — owned by `specs/device-racks/`;
  out of scope here.
- DAWproject template interoperability — owned by `SPEC-dawproject-interchange`.
