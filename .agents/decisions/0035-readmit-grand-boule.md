---
type: adr
id: 0035
title: Readmit Grand Boule with a finite FIR body
status: accepted
date: 2026-08-22
owner: The Sourdaw team
supersedes:
    - 0032
    - 0034
sources:
    - https://patents.google.com/patent/US7915515B2/en#claims
    - crates/daw-dsp/src/grand_boule/mod.rs
    - crates/daw-dsp/src/grand_boule/parameters.rs
    - crates/daw-dsp/src/grand_boule/string.rs
    - crates/daw-dsp/src/grand_boule/engine.rs
    - crates/daw-dsp/src/grand_boule/soundboard.rs
    - crates/daw-dsp/tests/device_process_rt.rs
    - scripts/checkReleaseInventory.ts
---

# 0035 - Readmit Grand Boule with a finite FIR body

## Context

ADR 0032 withheld Grand Boule pending claim-level and provenance evidence. ADR 0034 then excluded
its constructor from distributed WASM. Readmission is based on a concrete system design-around and
project-owned tuning, not on patent-family status, a public-source search, or a theory that claim 1
requires every coefficient to be calculated in one operation.

The relevant system-level map for independent claim 1 is:

| Claim 1 element                                                                                                                           | Grand Boule implementation                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Digital signals simulate a keyboard instrument with strings linked to a sounding board                                                    | Grand Boule is presented as a modelled piano and therefore meets this product-level description.                                                                                                              |
| A real-time sound-production module responds to a performance trigger and uses coefficients representing at least one string parameter    | MIDI note events trigger the real-time engine, whose string banks use project-tuned string coefficients.                                                                                                      |
| A presynthesis module produces damping and frequency coefficients for each exponentially damped sinusoidal partial                        | String configuration computes per-partial coefficients. The release decision does not depend on whether that code is labelled or timed as “presynthesis.”                                                     |
| Those coefficients are produced from physical parameters that comprise both a measurable sounding-board property and the string parameter | Not implemented. String coefficient derivation receives no sounding-board property. The body has no measurable-property model and supplies no value to string derivation.                                     |
| The sounding-board parameter characterizes a measurable physical property that influences timbre                                          | Not implemented. The body uses fixed project-authored FIR delays and gains. Brightness, resonance, tone color, and send are mix controls, not dimensions, materials, impedance, or other measured properties. |
| Real-time output uses the coefficients produced by that presynthesis module to render the plurality of partials                           | String partials are rendered, but the required upstream sounding-board-plus-string physical-parameter derivation is absent.                                                                                   |

Independent claim 24 places substantially the same device elements in a recorded-program medium.
The distributed source and WASM satisfy the medium aspect, but do not add the absent sounding-board
physical parameter or a path from such a parameter into partial damping or frequency coefficients.
Dependent claims cannot restore an element missing from the independent claim they depend on; this
ADR records no separate conclusion about implementations outside the exact shipped system.

## Decision

Readmit Grand Boule to source, browser, and desktop releases with the modal soundboard replaced by a
fixed finite feed-forward FIR body. The body owns warm/open stereo kernels, each formed from twelve
two-tap delay stages with deterministic unequal delays and signs. It has no feedback, recursive
filter, oscillator, modal-frequency table, damping table, or partial-indexed body data, and reaches
exact silence after a bounded 1-1.5 second impulse tail.

The body runs once after all voices and sympathetic output have been aggregated at the bridge.
`soundboard_send` is its input gain; `soundboard_brightness` crossfades the fixed warm/open kernels;
`body_resonance` scales late diffusion; and `tone_color` crossfades early and diffuse contributions.
Control changes select existing data and never rebuild kernels or alter string state. Construction
owns all allocation; processing and control updates allocate nothing.

Independently revoice the ambiguous project parameter families: hammer mass and exponent,
inharmonicity `B`, and the smooth and note-varying Railsback-style tuning curves. They are labelled
as project tuning rather than measurements or published instrument data. Standard temperament,
MIDI, equal-temperament, and ordinary piano-range facts remain ordinary engineering inputs.

Replace unmeasured brand-specific morph labels and newly written IDs with neutral product voicings.
Legacy IDs remain accepted only to load existing serialized projects and resolve immediately to the
neutral voicing records.

The release checker pins the FIR source shape, project-tuning provenance label, neutral visible
voicing IDs, complete release reachability, exact tracked-source digests, and generated WASM
surface. Focused Rust tests pin finite-tail behavior, aggregate-bridge ordering, control isolation
from string coefficients, output level, and allocation freedom with the FIR tail active.

## Consequences

- ADR 0032's withholding decision and ADR 0034's native-only WASM decision are superseded.
- ADR 0033 remains historical architecture context; the new FIR body preserves its aggregate
  bridge boundary while replacing the resonator implementation it described.
- Grand Boule is release-reachable on web and desktop under the project-source grant recorded by
  the release inventory.
- This is an engineering design-around record for the exact implementation and claim text reviewed.
  It is not a legal opinion, a patent-status conclusion, or certainty about future claims,
  jurisdictions, or differently configured systems.
