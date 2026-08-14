# Collaboration module — Agent Guidelines

P2P collaboration sessions over Automerge CRDTs. There are **three independent connectivity paths** — know which one you're touching:

1. **Serverless WebRTC (browser):** manual offer/answer exchange with QR-code invites — `repositories/peerConnection.ts` (raw `RTCPeerConnection`), `useCases/collaboration/generateInvite.ts` / `acceptAnswer.ts`. No signaling server involved; the `qrcode` dependency is used here.
2. **WebSocket relay (optional signaling):** standalone package at repo-root `server/` (`sourdaw-collab-server`, `ws`-based, port 8787). It is **not** in the pnpm workspace and has its own `package-lock.json`; `scripts/health-gates-server.sh` builds it during explicit full validation. Message types: join/leave/action/cursor/sync-request/sync-response/state-update.
3. **Native LAN (Tauri):** the `daw-collab` crate — Automerge `DocumentStore`, `.sdaw` binary bundles (magic `SDAW`), mDNS discovery (`_sourdaw._tcp.local.`), exposed via 11 `collab_*` Tauri commands.

## Trust model — an invite is unconditional write access

There are **no roles and no per-peer permissions.** An invite string is a bearer
credential granting full write access: any peer that completes the handshake can
edit the project without restriction, and its changes merge into every peer's
document. There is no viewer/read-only mode, no capability check, no host approval
between joining and writing, and no revocation short of ending the session.

A role scaffold (`PermissionManager`, `PeerRole`, `viewer` / `transport-controller`
tiers, `canEdit` / `canControlTransport` / `getRole`, a `__permissions__` sync doc)
used to live in `useCases/permissions.ts`. It was **deleted** under
[ADR 0016](../../../.agents/decisions/0016-ultracode-session-scope-and-standard.md)
ruling 4: it was unreachable — `editor` was the only role ever granted, so every
check returned true — and leaving it risked the next feature believing it enforced
something. Do not reintroduce a role check by reading a role off the sync path;
restricting a peer means building and enforcing a real permission model
(see the superseded `.agents/specs/collaboration-roles-trust/spec.md` for the
shape that was considered: host approval, audit log, signed tokens).

The one remaining asymmetry is **not** a permission: branch metadata
(`__branches__`) is host-authoritative — a structural single-writer rule for one
document, enforced in `buildAutomergeSyncHooks` (`useCases/collaboration/sessionManagement.ts`).

## Notes

- Document state itself is owned by the CrdtDocument module (projections, branches, semantic history); this module owns transport/session/presence, not the CRDT model.
- `@automerge/automerge` is imported here and in CrdtDocument, MIDI, and Yeast — Vite aliases it to the base64 wasm entrypoint (`vite.config.ts`); don't "fix" that alias.
- Presence/cursors and asset transfer ride the same peer connection as document changes.
