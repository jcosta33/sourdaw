# Collaboration module — Agent Guidelines

P2P collaboration sessions over Automerge CRDTs. This module owns transport, session and presence;
CrdtDocument owns the document model — projections, branches, semantic history. Presence, cursors
and asset transfer ride the same peer connection as document changes.

Vite aliases `@automerge/automerge` to the base64 wasm entrypoint (`vite.config.ts`). Do not "fix"
that alias.

## Connectivity paths — know which one you are touching

They are independent. A change to one carries to none of the others.

- **Serverless WebRTC (browser).** Manual offer/answer exchange with QR-code invites —
  `repositories/peerConnection.ts` (raw `RTCPeerConnection`),
  `useCases/collaboration/generateInvite.ts` / `acceptAnswer.ts`. No signaling server is involved;
  the `qrcode` dependency belongs to this path.
- **WebSocket relay (optional signaling).** A standalone package at repo-root `server/`
  (`sourdaw-collab-server`, `ws`-based, port 8787). It is **not** in the pnpm workspace and has its
  own `package-lock.json`; `scripts/health-gates-server.sh` builds it during explicit full
  validation. Its wire protocol lives with it, not here.
- **Native LAN.** The `daw-collab` crate — Automerge `DocumentStore`, `.sdaw` binary bundles (magic
  `SDAW`), mDNS discovery (`_sourdaw._tcp.local.`), exposed via the `collab_*` native commands.

## Trust model — an invite is unconditional write access

An invite string is a bearer credential granting full write access. Any peer that completes the
handshake edits the project without restriction, and its changes merge into every peer's document.
There are **no roles and no per-peer permissions**: no viewer or read-only mode, no capability
check, no host approval between joining and writing, no revocation short of ending the session.

The role scaffold that used to live in `useCases/permissions.ts` was **deleted** under
[ADR 0016](../../../.agents/decisions/0016-ultracode-session-scope-and-standard.md) ruling 4: it
was unreachable — `editor` was the only role ever granted, so every check returned true — and
leaving it risked the next feature believing it enforced something. Never reintroduce a role check
by reading a role off the sync path; a `__permissions__` doc now falls through to Automerge sync,
which drops it as an unknown doc. Restricting a peer means building and enforcing a real permission
model — the shape considered (host approval, audit log, signed tokens) is in the superseded
[`.agents/specs/collaboration-roles-trust/spec.md`](../../../.agents/specs/collaboration-roles-trust/spec.md).

The one remaining asymmetry is **not** a permission: branch metadata (`__branches__`) is
host-authoritative, a structural single-writer rule for one document, enforced in
`buildAutomergeSyncHooks` (`useCases/collaboration/sessionManagement.ts`).
