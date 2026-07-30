# ADR 0026: LLM automation command surface

**Status:** Accepted

## Context

The application already has typed, Automerge-backed actions for creating automation lanes and points and for enabling or disabling lanes, but the provider-neutral executable registry does not expose them. The current project context also omits automation lanes, so a provider cannot ground a lane reference or validate a point against current state.

Automation point undo needs a stable point identity: a numeric array index can drift after collaborative or recording insertions. New device-parameter lanes also need target-specific range metadata that the current lane-creation action does not preserve.

## Decision

- Expose `addAutomationLane`, `addAutomationPoint`, and `setAutomationLaneEnabled` through the executable LLM registry and bridge.
- Publish non-clip automation lanes and existing points in app-owned `ProjectContext`, but serialize only bounded lane metadata and point counts to providers.
- Ground existing-lane commands to one exact lane ID or parameter name, scoped by its owner track when names repeat.
- Limit LLM-created lanes to track `gain` and `pan`; derive the stored display name locally instead of trusting provider text.
- Accept only finite, non-negative point beats, values within the selected lane's current bounds, supported curve names, and beats without an existing point; ground percentages against that lane's range while preserving signed pan percentages.
- Reject conflicting writes to the same point position within one provider batch while allowing distinct points on one lane.
- Give newly added lanes and points command-owned stable IDs for exact undo/redo, regenerate and remap those IDs during macro replay, treat all three commands as bounded reversible, and reject replay-only IDs from provider payloads.

## Consequences

Providers can create and edit useful vibe-mixing automation through validation, grounding, `executeAppAction`, Automerge history, receipts, and exact undo without receiving unbounded recorded-point arrays. Existing device-parameter lanes can receive points when their bounds are known in project state, while creation of new device-parameter lanes remains deferred until the action can persist descriptor-backed bounds safely.
