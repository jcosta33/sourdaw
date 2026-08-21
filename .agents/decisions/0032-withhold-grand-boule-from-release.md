---
type: adr
id: 0032
title: Withhold Grand Boule from release
status: superseded by 0035
date: 2026-08-20
owner: The Sourdaw team
sources:
    - https://patents.google.com/patent/US7915515B2/en
    - https://patentscope.wipo.int/search/en/detail.jsf?docId=WO2008012412
    - https://api.archives-ouvertes.fr/search/?q=halId_s%3Ahal-00688679
    - crates/daw-dsp/src/grand_boule/string.rs
    - crates/daw-dsp/src/grand_boule/soundboard.rs
    - crates/daw-dsp/src/grand_boule/parameters.rs
    - src/infra/release/deviceReleaseAdmission.ts
---

# 0032 - Withhold Grand Boule from release

**Accepted 2026-08-20.** Preserve the implementation. Exclude it from released product paths until
claim-level and parameter-source evidence admits it.

## Context

US7915515B2 claims a device that derives modal frequencies and damping from string and soundboard
physical parameters, then renders partials in real time from a performance trigger. Claim 24 applies
the same elements to recorded software. The published record reports the United States patent active
through 2027-10-20; current status across the patent family is not proved here.

Grand Boule configures exponentially damped string partials from string parameters, builds a modeled
soundboard resonator bank, and renders notes from MIDI. That is too close to admit without a complete
independent-claim map. Labels, module boundaries, and open-source publication do not remove patent
risk.

The physical-parameter report `hal-00688679` has no explicit reuse license in its HAL metadata. The
current fitted curves are not proved independently derived from reusable source data.

## Decision

`deviceReleaseAdmission.ts` denies `grand-boule`. Released catalogs, presets, project templates,
agent manifests, live construction, and offline rendering obey that gate. Existing project data and
the complete implementation remain intact.

Current implementation guidance must not direct work from patent text or unlicensed parameter
tables. Re-admission requires:

1. Current patent-family status in every release jurisdiction.
2. An element-by-element map over every live independent claim and the exact candidate.
3. A tested design-around for each complete mapped claim, if any.
4. Exact provenance and reuse terms for every physical constant, fitted curve, table, and asset.
5. Focused proof that every released discovery and runtime path follows the admission decision.

This records release evidence, not legal certainty.
