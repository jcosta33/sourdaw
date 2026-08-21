---
type: adr
id: 0035
title: Readmit Grand Boule to source, web, and desktop releases
status: accepted
date: 2026-08-22
owner: The Sourdaw team
supersedes:
    - 0032
    - 0034
sources:
    - https://patents.google.com/patent/US7915515B2/en#claims
    - https://inria.hal.science/hal-00688679v2
    - https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf
    - crates/daw-dsp/src/grand_boule/parameters.rs
    - crates/daw-dsp/src/grand_boule/string.rs
    - crates/daw-dsp/src/grand_boule/engine.rs
    - crates/daw-dsp/src/grand_boule/soundboard.rs
    - .agents/decisions/0033-grand-boule-string-soundboard-boundary.md
---

# 0035 - Readmit Grand Boule to source, web, and desktop releases

## Context

ADR 0032 withheld Grand Boule pending claim and provenance evidence. ADR 0034 then removed it from
the distributed `daw-dsp` WASM surface. That evidence now exists.

US7915515B2 is the only patent-family member reported active. The FR, CN, EP, JP, AT, and WO members
are expired or ceased; CA is abandoned. Independent claim 1 requires one presynthesis operation to
derive partial damping and frequency coefficients from physical parameters that include both a
soundboard property and a string property. Claim 24 repeats that requirement for recorded software.

Grand Boule does not perform that operation. `StringModalParameters` and string coefficient
derivation receive no soundboard property. Voices produce a completed bridge signal; the separate
`Soundboard` stage processes that signal afterward. ADR 0033 and focused Rust tests pin this
boundary. No confirmed-live independent claim fully maps.

The implementation is project-authored code. Unique implementation identifiers produced no public
source match. `parameters.rs` contains fitted expressions and sparse anchors, not the HAL RT-0425
table. Direct comparison found materially different hammer formulas:

| Quantity    | HAL RT-0425 section 3.1              | Grand Boule                 |
| ----------- | ------------------------------------ | --------------------------- |
| Hammer mass | `-6.2348e-5*i + 0.0112` kg           | `11*exp(-0.0134*(key-1))` g |
| Exponent    | `2.4295e-4*i^2 - 0.007703*i + 2.337` | `2 + 0.017*(key-1)`         |
| Stiffness   | `10^(5.3097e-2*i + 7.6425)`          | `10^(8 + 0.020*(key-1))`    |

No HAL text, table, recording, or imported Grand Boule asset ships. Copyright Office Compendium
sections 313.3(A) and 313.3(C) exclude mathematical formulas, algorithms, scientific methods, and
facts from copyright; the report's protectable expression or selection is not reproduced.

## Decision

Readmit the complete Grand Boule implementation to public source, browser, and desktop releases.
Restore the `GrandBouleInstance` constructor and implementation to the distributed `daw-dsp` WASM
package, live Worker transport, inline offline transport, discovery, presets, templates, and runtime
manifests.

ADR 0033 remains binding: string partial frequency and damping derivation must not receive a
soundboard property. The completed bridge signal enters the independent downstream `Soundboard`
stage. Focused tests must keep that boundary observable.

Release inventory records Grand Boule as project source under the project grant. Its source and
generated WASM remain covered by exact path, artifact-census, manifest, and digest checks.

## Consequences

- ADR 0032's withholding decision and ADR 0034's native-only WASM decision are superseded.
- Grand Boule is release-reachable on web and desktop.
- The separate OS-10 project grant still governs project-source licensing.
- This is an engineering release decision based on current evidence, not legal certainty.
