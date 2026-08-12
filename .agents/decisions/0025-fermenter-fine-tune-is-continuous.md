---
type: architecture-decision-record
status: accepted
date: 2026-08-08
---

# Fermenter fine tune is continuous

## Decision

Fermenter's `oscFine` parameter is continuous across its full -100 to +100 cent range. The descriptor write contract, Fermenter parameter metadata, custom Fine knob, and macro-destination list must all expose that same continuous behavior. `oscCoarse` remains stepped in whole semitones.

The duplicated Arrangement and Fermenter parameter tables remain separate because models cannot cross module boundaries. A contract test must compare their complete parameter populations and integer-versus-continuous declarations so future drift fails visibly.

## Rationale

Fine tune is the sub-semitone half of a coarse/fine pair. Quantizing it to one-cent increments discards continuous modulation the engine already accepts as a clamped `f32`. Fermenter's `unisonDetune` already uses the same unit and magnitude continuously. Surveyed synthesizer and sampler controls also treat fine tune or detune as continuous while commonly keeping coarse transpose stepped.

## Consequences

- The custom Fine knob accepts fractional-cent edits.
- `oscFine` becomes available as a macro destination.
- Existing stored values remain valid; no migration or DSP change is required.
- Any future descriptor/Fermenter step mismatch fails the metadata weld.
