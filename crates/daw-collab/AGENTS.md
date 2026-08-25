# crates/daw-collab — Agent Guidelines

Native LAN collaboration engine, mDNS peer discovery, Automerge CRDT binary synchronization, and `.sdaw` bundle persistence.

## Domain Ownership

- Owns local network discovery via mDNS (`_sourdaw._tcp.local.`) and peer-to-peer TCP/UDP socket management.
- Owns native Automerge CRDT document storage and binary sync exchange.
- Owns `.sdaw` binary bundle packaging (magic header `SDAW`) containing project CRDT state and embedded binary audio assets.
- Does not own browser WebRTC signaling (`src/modules/Collaboration`) or DAW audio playback (`daw-engine`).

## Invariants & Traps

- **Bearer Trust Model**: Handshake verification follows ADR 0016—valid session tokens confer unrestricted write access; no per-peer role or permission checks exist.
- **Header Magic & Chunking**: `.sdaw` files must begin with valid `SDAW` magic bytes and format version headers; binary asset chunks must respect framing boundaries to prevent stream corruption.
- **Sync Threading**: Network I/O and Automerge document mutations execute asynchronously on tokio runtimes and must never block audio or UI event loops.

## Verification

```bash
cargo test --package daw-collab
```
