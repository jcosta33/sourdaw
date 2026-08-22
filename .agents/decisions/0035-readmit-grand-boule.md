---
type: adr
id: 0035
title: Readmit Grand Boule with a finite FIR body
status: accepted
date: 2026-08-22
owner: The Sourdaw team
supersedes:
    - 0032
    - 0033
    - 0034
sources:
    - https://patents.google.com/patent/US7915515B2/en#claims
    - https://www.acs.psu.edu/drussell/publications/pianohammer.pdf
    - https://www.speech.kth.se/prod/publications/files/qpsr/1993/1993_34_4_015-022.pdf
    - https://www.ioc.ee/~stulov/actaa2005.pdf
    - https://copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf#page=22
    - crates/daw-dsp/src/grand_boule/mod.rs
    - crates/daw-dsp/src/grand_boule/parameters.rs
    - crates/daw-dsp/src/grand_boule/coupled_strings.rs
    - crates/daw-dsp/src/grand_boule/string.rs
    - crates/daw-dsp/src/grand_boule/engine.rs
    - crates/daw-dsp/src/grand_boule/hammer.rs
    - crates/daw-dsp/src/grand_boule/mechanical_noise.rs
    - crates/daw-dsp/src/grand_boule/voice.rs
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

Independently reauthor only the project voicing families that this campaign changed: hammer mass,
hammer exponent, hammer stiffness, inharmonicity `B`, the smooth and note-varying
Railsback-style tuning curves, and prompt/aftersound polarization decay. The polarization curves
derive only from each string's frequency; they receive no soundboard or body input and represent no
measurable soundboard property. This statement does not characterize the retained scientific
relations and measurements below as independently revoiced. Standard temperament, MIDI,
equal-temperament, and ordinary piano-range facts also remain ordinary engineering inputs.

Replace unmeasured brand-specific morph labels and IDs with neutral product voicings. Morph state
was never persisted before this decision, so branded aliases have no compatibility duty and are not
accepted by the product or its project-state reader.

## Source Admission Record

Admission date: 2026-08-22. Actor and owner: Sourdaw team, OS-10. This record admits the following
project-authored tuning families: hammer stiffness, hammer exponent, hammer mass, inharmonicity B,
smooth stretch, deterministic note variation, and prompt/aftersound polarization decay; it also
admits the four neutral product voicings. Allowed inputs are equal temperament, MIDI note/range,
the current key index, frequency derived from that key, ordinary numeric operations, and the
explicit neutral voicing values below. Excluded inputs are unsupported measured literals and
tables, named instrument data, brand labels, bridge-admittance or body values, and the removed
branded aliases. The exact retained academic inputs and their engineering reuse basis are recorded
separately rather than swept into the reauthorship claim.

| Admitted result                                                                    | Inputs and derivation                                                                                                                                                                                                                                                                                                                    | Resulting data                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hammer stiffness/exponent, mass, inharmonicity, smooth stretch, and note variation | `PianoVoice::strike` calls `hammer_stiffness_k`, `hammer_exponent_p`, `hammer_mass_kg`, `key_fundamental_hz`, and `CoupledStringAssembly::configure`. That helper constructs `StringModalParameters`; `ModalString::configure_from_string_parameters` derives each modal frequency and damping coefficient, including `inharmonicity_b`. | Project-authored helper outputs and modal coefficients; there is no `StringParameters::for_key` symbol and no measured instrument table is read.                                                                                        |
| Prompt and aftersound polarization decay                                           | `register = clamp(log2(frequency / 27.5) / log2(4186.01 / 27.5), 0, 1)`; `prompt_hz = 0.58 + 0.72*register + 7.2*register^2.4`; `aftersound_hz = 0.012 + 0.025*register + 0.105*register^2`.                                                                                                                                             | Frequency-only decay coefficients in `coupled_strings.rs`; no bridge or soundboard value is an input.                                                                                                                                   |
| Neutral voicings                                                                   | Explicit product tuples in `GrandBouleMorphState.ts`, in order: hardness, mass, brightness, sympathetic level, body resonance, tone color.                                                                                                                                                                                               | `balanced-grand` = `(0.92, 1.08, 0.48, 0.58, 0.52, -0.08)`; `mellow-grand` = `(0.72, 1.25, 0.32, 0.74, 0.82, -0.58)`; `clear-grand` = `(1.34, 0.82, 0.78, 0.36, 0.42, 0.56)`; `singing-grand` = `(1.12, 0.94, 0.68, 0.66, 0.57, 0.28)`. |

### Retained scientific inputs

| Input                                                                 | Exact source                                                                                                                                 | Engineering reuse basis                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hammer contact-spectrum anchors at low/high register and strike speed | D. A. Russell and T. D. Rossing, “Testing the Nonlinearity of Piano Hammers Using Residual Shock Spectra,” _Acustica_ 84(5), 967-975 (1998). | Factual scientific measurements are used as interpolation anchors in `voice.rs`. The interpolation, MIDI mapping, filter, and source code are project-authored; no source code or table expression was copied.                       |
| Precursor and other structure-borne mechanical-transient guidance     | A. Askenfelt, “Observations on the Transient Components of the Piano Tone,” _STL-QPSR_ 34(4), 15-22 (1993).                                  | The observed transient categories and timing relationship are scientific guidance. Burst durations, levels, filters, pooling, and code in `mechanical_noise.rs` are project-authored; no source code or table expression was copied. |
| Simplified three-parameter hereditary hammer relation                 | A. Stulov, “Experimental and Computational Studies of Piano Hammers,” _Acta Acustica united with Acustica_ 91(6), 1086-1097 (2005).          | The published scientific equation is implemented in project-authored Rust in `hammer.rs`; no source code or table expression was copied.                                                                                             |

This engineering reuse classification follows the distinction between copyrightable expression
and ideas, methods, principles, discoveries, and facts described in U.S. Copyright Office
Compendium (Third), sections 313.3(A) and 313.3(C). It records the project's admission basis; it
does not claim legal certainty or replace advice about any particular jurisdiction or release.

The decisive checks are the exact source-shape and legacy-literal rejections in
`scripts/checkReleaseInventory.ts`, the coefficient-isolation test in `engine.rs` covering every
body-only control at initial note-on and mid-note decay reset, the native/browser 64-voice benchmark
census, and the pinned tracked-source digests in the `grand-boule` release-inventory row. Those
checks pin admitted bytes and reject known legacy literals; they do not, and cannot, prove authorship.

The release checker pins the FIR source shape, project-tuning provenance label, neutral visible
voicing IDs, complete release reachability, exact tracked-source digests, and generated WASM
surface. Focused Rust tests pin finite-tail behavior, aggregate-bridge ordering, control isolation
from string coefficients, output level, and allocation freedom with the FIR tail active.

## Consequences

- ADR 0032's withholding decision and ADR 0034's native-only WASM decision are superseded.
- ADR 0033 is superseded; its historical body remains as context for the architecture it described.
- Grand Boule is release-reachable on web and desktop under the project-source grant recorded by
  the release inventory.
- This is an engineering design-around record for the exact implementation and claim text reviewed.
  It is not a legal opinion, a patent-status conclusion, or certainty about future claims,
  jurisdictions, or differently configured systems.
