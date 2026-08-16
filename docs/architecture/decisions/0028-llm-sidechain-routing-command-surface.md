# ADR 0028: LLM sidechain routing command surface

**Status:** Accepted

**Narrow exception:** ADR 0032 supersedes only this decision's endpoint-only and exactly-one-supported-device clauses for the revision-bound, capability-scoped MF-06 workflow. Every other constraint below remains accepted.

## Context

Sourdaw already defines `addSidechainRoute` and `removeSidechainRoute`, but their canonical endpoint-only payloads disagree with stale runtime validators, are absent from provider-neutral project context and executable grounding, and select the first matching route or device. Their inverses lose route identity and configuration, and add currently wires the live audio graph before the Automerge transaction commits.

A provider-facing command must stay simple while application-owned execution preserves exact route identity, rejects ambiguous or unsupported targets, and keeps durable CRDT truth and the live engine synchronized across commit failure, ambiguous commit, undo, redo, and macro replay.

## Decision

- Expose endpoint-only provider tools for `addSidechainRoute` and `removeSidechainRoute`, both classified authority-sensitive and requiring confirmation that names the grounded source, destination, IDs, and direction.
- Ground source and destination to distinct exact routable tracks. Add requires exactly one `builtin-sidechain-compressor` on the destination, no duplicate source/device route, and no output/send/sidechain cycle. Remove requires exactly one existing route matching the two endpoints; ambiguity is rejected. Validate accepted batches against prospective routing, track, and device state so cross-action cycles or invalidation never reach confirmation.
- Publish bounded sidechain route context containing route ID, endpoints, target device, target parameter, and gain so removal and no-op checks use durable project truth.
- Extend only the internal app-action payload with command-owned route identity and complete route snapshot fields. Providers cannot supply route IDs, target device IDs, target parameter IDs, or gain.
- Mint stable route IDs before execution, add and remove strictly by route ID, preserve the complete removed route in the inverse, and return explicit written, no-write, or conflict outcomes.
- Mutate the CRDT-backed sidechain store inside `executeAppAction`, but defer live engine changes until commit. Reconcile the source/device engine key from durable projected truth after normal commits, ambiguous commits, post-commit effect failure, and local or remote hydration.
- Canonicalize concurrent merged route-ID and source/device collisions deterministically at the CRDT projection boundary; quarantined shared rows remain untouched until a later intentional write replaces the slot.
- Detect supported devices by exact type and verify device ownership. Absent routes and unsupported or ambiguous device targets are no-ops or conflicts rather than history entries.
- Regenerate and remap sidechain route IDs during macro replay so later removal and inverse actions target the replayed route.

## Consequences

WebLLM and arbitrary hosted providers can propose sidechain routing through the same typed, grounded, confirmed command path without a server. Durable project state remains authoritative; live engine effects occur only after commit or reconciliation, and undo/redo preserves exact route identity and configuration.
