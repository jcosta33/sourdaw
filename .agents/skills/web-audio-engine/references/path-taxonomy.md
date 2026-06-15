# Fast path vs slow path — full taxonomy

The engine separates two classes of mutation. Conflating them is the single most
common engine performance bug: a parameter gesture that triggers a graph rebuild.

## Fast path

Use for:

- parameter changes
- transport state nudges
- automation value application
- meter snapshot reads
- sample-accurate runtime control

Requirements:

- minimal overhead
- no graph rebuild
- no heavy object churn
- no cross-layer leakage

## Slow path

Use for:

- graph rebuilds
- topology diffs
- routing changes
- device/plugin insertion or removal
- transport reset-level changes
- offline render preparation

Requirements:

- explicit orchestration
- clear synchronization boundaries
- no accidental triggering on hot user gestures unless intentionally coalesced

## Parameter changes vs topology changes (the source distinction)

This distinction is what assigns work to a path.

### Parameter changes

Examples:

- fader movement
- pan change
- mute/bypass
- automation values
- parameter modulation
- plugin/device parameter updates

These should use fast paths:

- `AudioParam`
- direct engine parameter application
- real-time-safe command paths
- lightweight node-local updates

These must **not** rebuild the graph.

### Topology changes

Examples:

- add/remove track
- add/remove bus
- add/remove plugin/device
- routing rewiring
- send/return changes
- clip source replacement if it changes node structure

These may use slower reconciliation paths.

## Reconciliation granularity (slow path, done right)

The engine should prefer targeted reconciliation over full teardown/rebuild.

Good reconciliation granularity:

- apply changed parameter only
- update changed routing edge only
- add/remove affected nodes only
- rebuild only the affected subgraph when practical

Bad pattern:

- "something changed, rebuild the entire engine"
