# ADR 0025: LLM device-chain lifecycle commands

**Status:** Accepted

## Context

The provider-neutral LLM bridge can adjust and bypass existing devices, but it cannot insert or remove them. The underlying `addDevice` and `removeDevice` actions also claimed to be undoable without emitting inverse actions, so exposing them would break the command boundary's undo guarantee.

Hosted providers run client-side and must not invent plugin identifiers or bypass the existing action transaction path. Available built-ins differ by runtime: web builds must retain WebLLM and web-capable devices, while native builds may also expose native devices.

## Decision

- Add `addDevice` and `removeDevice` to the executable LLM registry.
- Publish the current runtime's platform-filtered built-in device IDs and display names in `ProjectContext`; provider output may select only one of those entries.
- Ground insertion to an explicitly referenced device name or ID and an eligible project track. Ground removal to one existing project device, optionally scoped by its owner track.
- Treat insertion as bounded reversible and removal as destructive reversible, so removal requires confirmation under the existing execution policy.
- Reserve a device ID before executing `addDevice`, reject identity collisions, and emit an exact removal inverse.
- Snapshot a removed device and its chain index before execution; restore that snapshot through an internal `restoreDevice` action that rejects stale ownership or identity conflicts and reconciles the live strip.
- Provider payloads cannot supply replay identities or invoke inverse-only actions.
- Reject conflicting device-lifecycle writes in one provider batch rather than depending on provider order.

## Consequences

All providers share one device lifecycle surface and continue through runtime validation, grounding, confirmation, `executeAppAction`, Automerge history, receipts, and undo. External plugins remain removable when already present, but LLM insertion is limited to the platform-filtered built-in catalog until an external-plugin admission contract exists. Device reordering and preset loading remain separate future commands.
