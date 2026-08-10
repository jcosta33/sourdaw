# ADR 0032: Capability-scoped LLM sidechain targeting

- Status: Accepted
- Date: 2026-08-10

## Context

ADR 0028 admits endpoint-only provider calls for `addSidechainRoute` and requires the destination to contain exactly one supported compressor. That remains a safe compatibility surface for ordinary sidechain requests, but it cannot represent the exact MF-06 workflow: create a sidechain from one uniquely identified Kick to every supported compressor across the complete dynamically identified set of bass tracks. A bass track can own more than one supported compressor, so endpoint-only calls cannot distinguish all required targets.

The provider must receive enough application-owned evidence to propose the complete plan without gaining authority to choose the project scope, route identity, parameter mapping, or audio configuration.

## Decision

1. Preserve ADR 0028's endpoint-only `addSidechainRoute` calls and exactly-one-supported-device rule for requests without an application-supplied exact capability scope.
2. For the exact MF-06 intent only, AiRuntime may expose optional `targetDeviceId` in the provider tool payload after the application has computed a revision-bound capability scope. That scope contains the unique existing Kick, the complete set of eligible bass-compressor targets, current routes, and protected or excluded tracks and devices.
3. Device eligibility is application-owned and canonical: a target must be an exact supported sidechain-compressor type owned by a canonical bass track. Ambiguous source or bass roles, unsupported devices, locks, frozen tracks, already-satisfied routes, and stale project state fail closed or remain explicitly protected.
4. The provider plan must contain the complete exact set of allowed source-track, target-track, and target-device triples with no omission, enlargement, or duplicate. AiRuntime independently recomputes the capability from current project truth before grounding and normalizes an equivalent WebLLM or hosted-provider plan into application order.
5. `targetDeviceId` selects only a member of that recomputed exact set. Providers still cannot supply route IDs, target parameter IDs, gain, or other route configuration. Command owns route identity, the canonical target parameter, and the complete durable snapshot.
6. After grounding, confirmation, atomic Command execution, receipts, guarded undo and redo, collaboration behavior, and live-engine reconciliation use the existing ADR 0028 path.

This decision supersedes ADR 0028 only where its endpoint-only and exactly-one-supported-device rules prevent the exact capability-scoped MF-06 workflow. All other ADR 0028 constraints remain in force.

## Consequences

- One confirmed MF-06 batch can address every supported compressor, including multiple eligible compressors on one bass track, while excluding unsupported or protected targets.
- WebLLM and arbitrary hosted providers receive the same revision-bound capability and must produce equivalent normalized plans; neither becomes a project-state authority.
- Omitted, invented, duplicated, ambiguous, or stale targets reject the whole plan before confirmation or mutation.
- Legacy endpoint-only calls retain their prior compatibility and ambiguity rejection.
- Route IDs, parameter selection, gain, Automerge writes, runtime effects, and compensation remain application-owned.
