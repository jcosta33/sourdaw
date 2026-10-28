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

Run the changed server spec locally under the root resource guard, with an RSS estimate from the
nearest measured command:

```bash
pnpm guard --profile focused --max-rss-mib <estimate> -- sh -c 'cd server && npm exec -- tsx --test __tests__/<changed-spec>.spec.ts'
```

PR CI runs the full server suite and build through the server health gate. Inspect that result for
routine whole-server validation.
