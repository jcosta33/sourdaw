# ADR 0015: LLM device and send controls use introspected project bounds

- Status: Accepted
- Date: 2026-07-27

## Context

The first executable LLM surface can change track gain, pan, mute, solo, names, and tempo. Useful vibe-mixing also requires adjusting known device parameters, bypassing known devices, and changing sends to existing buses.

Device parameter ranges differ by device. Accepting arbitrary parameter names or unconstrained numeric values would let provider output create invalid project state or unsafe engine writes. Provider plans also need compensable handlers so the atomic batch path can restore runtime and project state after a later failure.

## Decision

AiRuntime extends its provider-executable allowlist with `setDeviceParameter`, `bypassDevice`, and `setSend` under these constraints:

1. Project context exposes only devices already present in project truth, their current bypass state, and descriptor-backed parameters that have a finite stored value, finite minimum and maximum, numeric type, and any discrete choices.
2. Unknown devices, external-plugin parameters without an accepted descriptor, absent parameter values, invented parameter IDs, out-of-range values, and non-discrete boolean, integer, or choice values are rejected before Command dispatch.
3. Send targets must be existing bus tracks, send levels stay within zero through one, and the Arrangement owner retains routing-cycle and track-eligibility enforcement.
4. Duplicate writes are keyed by device parameter, device bypass state, or track/bus send pair so one provider batch cannot overwrite its own earlier intent.
5. The owning handlers capture real prior state, detect semantic no-ops, and synchronously forward runtime effects so Command compensation remains deterministic.
6. A provider plan containing more than one action requires explicit user confirmation before the atomic batch executes.

The provider receives structured project state only. No rendered audio, audio analysis, model listening, external-plugin state, or arbitrary device catalog access is added.

## Consequences

- The agent can perform practical device and send adjustments through the same validated atomic path as track controls.
- Parameter support grows automatically for descriptor-backed devices already represented in project truth without widening the provider's authority.
- Unsupported or stale device targets fail closed with no project or engine effect.
