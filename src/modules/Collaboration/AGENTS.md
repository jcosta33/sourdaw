# Collaboration module — Agent Guidelines

P2P collaboration sessions over Automerge CRDTs. There are **three independent connectivity paths** — know which one you're touching:

1. **Serverless WebRTC (browser):** manual offer/answer exchange with QR-code invites — `repositories/peerConnection.ts` (raw `RTCPeerConnection`), `useCases/collaboration/generateInvite.ts` / `acceptAnswer.ts`. No signaling server involved; the `qrcode` dependency is used here.
2. **WebSocket relay (optional signaling):** standalone package at repo-root `server/` (`sourdaw-collab-server`, `ws`-based, port 8787). It is **not** in the pnpm workspace and has its own `package-lock.json`; CI builds it via `scripts/health-gates-server.sh`. Message types: join/leave/action/cursor/sync-request/sync-response/state-update.
3. **Native LAN (Tauri):** the `daw-collab` crate — Automerge `DocumentStore`, `.sdaw` binary bundles (magic `SDAW`), mDNS discovery (`_sourdaw._tcp.local.`), exposed via 11 `collab_*` Tauri commands.

## Notes

- Document state itself is owned by the CrdtDocument module (projections, branches, semantic history); this module owns transport/session/presence, not the CRDT model.
- `@automerge/automerge` is imported here and in CrdtDocument, MIDI, and Yeast — Vite aliases it to the base64 wasm entrypoint (`vite.config.ts`); don't "fix" that alias.
- Presence/cursors and asset transfer ride the same peer connection as document changes.
