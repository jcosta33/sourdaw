---
type: spec
id: SPEC-piano-plugin
title: Grand Boule release admission
status: blocked
owner: The Sourdaw team
sources:
    - ../../decisions/0032-withhold-grand-boule-from-release.md
---

# Grand Boule release admission

## Intent

Preserve Grand Boule while keeping it out of released products until its patent exposure and every
physical-parameter source are proved.

## Requirements

### AC-001 - No released product path

Grand Boule MUST be absent from catalogs, presets, project templates, agent manifests, live runtime
construction, and offline rendering while release admission is false. Existing project state MUST
survive unchanged.

### AC-002 - Source preservation

The engine, controls, project schema, and focused tests MUST remain available for maintenance and
future admission work. Withholding MUST NOT delete or silently rewrite user data.

### AC-003 - Patent proof

Admission requires current patent-family status for every release jurisdiction and an
element-by-element map proving that no complete live independent claim covers the exact shipped
implementation, or a tested design-around for every mapped claim.

### AC-004 - Parameter proof

Every physical constant, fitted curve, table, and imported asset MUST identify its exact source,
reuse terms, derivation, and decisive verification. A paper or repository without explicit reuse
terms does not admit copied data.

### AC-005 - One gate

One release-admission contract MUST control product discovery and runtime construction. A release
cannot expose Grand Boule by bypassing a presentation-only check.

## Open Questions

- Patent-family status outside the United States remains unproved.
- The exact provenance and independent derivation of the current parameter curves remain unproved.
