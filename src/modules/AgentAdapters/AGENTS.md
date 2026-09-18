# AgentAdapters module — Agent Guidelines

Normalized external-client contracts and the ephemeral session state behind them — which transports are open, which clients hold a grant, and which project those grants were issued against — plus the reference adapter that routes one admitted request (the LLM orchestration behind an agent belongs to AiRuntime; the operations themselves belong to Project, Command and AiRuntime).

## Public Contract Surface

- `stores`:
    - `externalClientSessionStore` (`ExternalClientSessionState`), `resetExternalClientSession`.
- `useCases`:
    - **Manifest**: `externalClientManifestPort` (the composition root registers the published protocol manifest), `normalizeExternalClientContract`.
    - **Local Approval**: `enableExternalClientTransport`, `disableExternalClientTransport`, `setExternalClientActiveProject`.
    - **Grants**: `issueExternalClientGrant`, `revokeExternalClientGrant`.
    - **Admission & Routing**: `admitExternalClientRequest`, `runCliClientRequest`.

## Key Subsystems

- **External Client Contract**: `models/ExternalClientContract.ts` names the transports, the operations, the schema version every client must speak, and the refusal reasons. Every client — MCP, CLI, macro, hardware, remote — speaks this one contract, so a second client cannot arrive with its own dialect.
- **Session Admission**: `useCases/admitExternalClientRequest.ts` is the single gate. It checks the transport, then the grant's existence, its transport and its token together, then revocation, then the schema version, then the granted operations, then the project scope on both sides, then whether the operation is published. Adapters route nothing until it answers `admitted`.
- **Contract Normalization**: `useCases/normalizeExternalClientContract.ts` maps each published operation onto the owner contract that answers it and copies that owner's `schemaVersion` as the contract version. An operation whose owner contract is absent from the manifest is `deferred` rather than silently missing.
- **Payload Contracts**: this module states none. A payload is parsed by the owner that answers the operation — `parseSemanticProjectQueryInput` and `parseAgentDiscoveryInput` from Project — so an external client is held to the same published contract as the local tool loop rather than to a copy of it.
- **Reference Adapter**: `useCases/runCliClientRequest.ts` admits, then routes reads and previews only.
- **Native Transport Probe**: `repositories/nativeTransportRepository.ts` reports whether a desktop shell is present; `enableExternalClientTransport` consults it before opening an externally reachable transport. It is the module's only desktop IPC caller.

## Invariants & Traps

- **Never Persisted**: the session store is in-memory only. A reload leaves every externally reachable transport disabled and every grant gone — an approval must be given again by whoever is at the machine, never inherited from a previous session.
- **Disabled By Default**: `mcp` and `remote` are reachable from outside this machine and start disabled; only `enableExternalClientTransport` opens them, and `issueExternalClientGrant` refuses to be the thing that opens one. The other three transports still require a grant.
- **No Shell, No Outside Door**: an externally reachable transport is carried by the desktop shell and by nothing else, so `enableExternalClientTransport` probes for it first and answers `native-transport-unavailable` rather than recording an approval no listener backs. Local transports are unaffected.
- **A Grant Is Its Token, Not Its Name**: `issueExternalClientGrant` mints 32 CSPRNG bytes and returns them once; the session keeps only their SHA-256 digest, so no store read, log line or refusal can hand anyone the bearer secret. Admission matches the client id **and** the presented token, and a name without the token refuses exactly as an ungranted name does — `grant-missing` — because a peer spraying client ids must not learn which ones exist. `grant-revoked` is told only to whoever presents the real token.
- **Revocation Stamps, Never Deletes**: a revoked grant keeps its record with `revokedAt` set, so admission answers `grant-revoked` rather than `grant-missing`. Deleting it would make a withdrawn client indistinguishable from a stranger.
- **Grants Are Project-Scoped Both Ways**: admission compares the request's project and the session's active project against the grant. A grant outlives neither the project it was issued against nor a request that names another one.
- **Adapters Never Execute, Commit Or Confirm**: no file in this module may reach `executeVersionedCommandBatchEnvelope`, import `@automerge`, or import `#/modules/CrdtDocument`. `command.approval` returns `approval-required` and stops; approval belongs to the local pending-action confirmation flow, where a person sees it. A previewed batch's isolated workspace is released here and its live project document never crosses the boundary.
- **Desktop IPC Only In `repositories/`**: `#/utils/desktopBridge` is imported by `repositories/` and nowhere else in this module.

## Verification

```bash
pnpm test:run src/modules/AgentAdapters/useCases/__tests__/externalAgentAdapterConformance.spec.ts
```
