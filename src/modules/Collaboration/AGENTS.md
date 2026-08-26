# Collaboration module — Agent Guidelines

Real-time P2P and LAN collaboration sessions over Automerge CRDTs, owning network transport, session lifecycles, peer presence, and binary asset streaming (document model, projections, and branches belong to CrdtDocument).

## Public Contract Surface

- `stores`: `collaborationStore`.
- `useCases`: `createSession`, `generateInvite`, `joinSession`, `acceptAnswer`, `leaveSession`, `broadcastPresence`, `onPresence`, `getAssetTransfer`, `canMutateBranchMetadata`, `canExecuteCommandBatch`, `getCollaborationHandlers`.
- `presentations/views`: `CollaborationPanel`, `PresenceOverlay`.
- Handlers: `getCollaborationHandlers` (`createCollabSession`, `joinCollabSession`, `leaveCollabSession`).

## Key Subsystems

- **Serverless WebRTC (browser)**: Manual offer/answer exchange with QR-code invites via `repositories/peerConnection.ts` (raw `RTCPeerConnection`), `useCases/collaboration/generateInvite.ts` / `acceptAnswer.ts`. No signaling server required; `qrcode` dependency belongs here.
- **WebSocket Relay (optional signaling)**: Standalone package at repo-root `server/` (`sourdaw-collab-server`, `ws`-based, port 8787). Wire protocol lives in server package.
- **Native LAN**: Handled by `daw-collab` crate — Automerge `DocumentStore`, `.sdaw` binary bundles (magic `SDAW`), mDNS discovery (`_sourdaw._tcp.local.`), exposed via `collab_*` native IPC commands.
- **Asset Streaming & Sync Framing**: `models/SyncChannelFraming.ts` and `useCases/assetTransfer.ts` chunk and multiplex binary sample payloads alongside Automerge sync messages over `RTCDataChannel`.

## Invariants & Traps

- **Trust Model (Bearer Write Access)**: An invite string is an unconditional write bearer credential. Any peer completing the handshake edits without restriction and changes merge directly. No roles, viewer modes, or per-peer permission checks exist (ADR 0016 ruling 4).
- **Host-Authoritative Branch Metadata**: `__branches__` is a structural single-writer document enforced in `buildAutomergeSyncHooks` (`useCases/collaboration/sessionManagement.ts`).
- **Automerge WASM Build**: Vite aliases `@automerge/automerge` to the base64 WASM entrypoint (`vite.config.ts`). Never alter or remove this alias.
- **DataChannel Framing Limits**: Payloads must respect chunk limits in `models/SyncChannelConstants.ts` to prevent RTCDataChannel buffer overflow or silent packet drop.
- **Storage Pressure**: Sessions tear down cleanly and flush pending doc states if client storage quotas are exceeded.

## Verification

```bash
pnpm vitest run src/modules/Collaboration
```
