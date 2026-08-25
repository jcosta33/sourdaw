# server/ — Agent Guidelines

Standalone WebSocket collaboration relay server (`sourdaw-collab-server`): room management, binary Automerge CRDT sync message forwarding, and peer discovery relay (default port 8787).

## Domain Ownership

- Owns remote WebSocket connection lifecycle, room subscriptions, client heartbeats, and binary frame broadcasting (`collab-server.ts`).
- Independent Node.js service with dedicated `package.json` and `tsconfig.json`.
- Does not own frontend DAW state, audio processing, or persistent CRDT document storage (operates as a stateless in-memory relay).

## Invariants & Traps

- **Stateless Relay**: The server routes messages between connected peers in a room without mutating, persisting, or validating Automerge CRDT payloads.
- **Bundle Isolation**: Must remain completely decoupled from frontend dependencies and `src/` modules.
- **Connection Teardown**: Peer disconnections and socket errors must clean up room memberships immediately to prevent memory leaks and zombie peer broadcasts.

## Verification

```bash
cd server && npm test
```
