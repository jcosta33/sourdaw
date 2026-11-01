# CRDT & Collaboration Architecture

Sourdaw's project truth is an [Automerge](https://automerge.org/) CRDT document. This single decision shapes four subsystems at once: how state is written, how undo works, how projects persist, and how multiple people edit the same project. This document describes that write path end to end and the collaboration transports built around it.

It complements:

- `DAW System Architecture` — truth/projection state model (§6)
- `TypeScript Module Architecture` — where CrdtDocument sits among modules
- The `crdt-collaboration` agent skill — the operational rules for working in this system

---

## 1. The write path

Every mutation of project truth flows through one funnel:

```
UI / command palette / AI / MIDI learn
        │
        ▼
executeAppAction(action)                src/modules/Command/useCases/executeAppAction.ts
        │
        ├─ handler lookup (registered in bootstrap, one map per module)
        ├─ noop check + describe() (pre-captures undo info)
        ├─ setSemanticContext(...)      from CrdtDocument/stores
        │
        ▼
Automerge storage transaction           the document is the write target
        │
        ▼
projections refresh stores              CrdtDocument/useCases/projection/
        │
        ▼
subscribers re-render                   useStore(Store<T>)
```

Two consequences fall out of this shape:

1. **Undo is an inverse-action stack beside the document, not Automerge history.** An undoable handler's `describe()` runs before `execute()` and returns an inverse `AppAction`. After the transaction commits, `executeAppAction` pushes that pair as an undo entry onto `undoStore` (`src/modules/Command/stores/undoStore.ts`); `undo` replays the inverse through `executeAppAction` with `skipUndo`, so an undo is itself an ordinary document write. Code outside the funnel can register a closure entry (`pushUndoEntry`, a `callback` entry in `models/UndoEntry.ts`) for state the document does not hold, such as audio buffers. Invariants:
    - The stack is per session and per tab: it holds only this editor's actions, never a peer's, and is mirrored to `sessionStorage` solely so a reload can restore it. The mirror is discarded unless the project id and the document witness (`captureDurableDocumentWitness`) still match, because an inverse is only sound against the document it was captured from.
    - An inverse is checked against the current document only by its own handler. A single entry refuses when the inverse's `execute` returns `conflict`, as `setClipGain` does when the clip's gain no longer equals the `expectedGain` the inverse captured; an atomic group, whose members all carry an inverse action, replays as one batch and also refuses when any member's `validate` rejects. A refusal writes nothing and keeps the entry. A group that mixes callback or inert entries undoes member by member, newest first, so a conflict part-way through keeps the newer members undone and leaves the conflicting member and every older one at the head, retryable. Undo adds one admission of its own: a recorded `trimClipStart` inverse without `midiOffsetBeats`, captured before MIDI trim offsets were stored, replays only when its clip still resolves to one eligible target and every inverse before it in the batch is a known metadata action (`getLegacyTrimInverseReplayFailure`); otherwise it refuses as a conflict. An inverse with neither check writes unconditionally, so its undo overwrites a newer remote edit of the same target.
    - Undo steps past a refused unit onto the one beneath only when every member of the unit beneath resolves to a handler declaring `canReportConflict`, the flag a handler sets once its `execute` has a genuine conflict path; the refused unit stays at the head, retryable.
    - An entry whose inverse is `null` is inert: undo drops it without writing, and redo never re-applies it. A document write outside `executeAppAction` gets no entry unless its writer pushes a callback entry itself.
    - The document's own history is a separate record and not the undo stack. `executeAppAction` attaches a semantic context, so each Automerge change carries a readable message, and `actionHistoryStore` holds labelled entries with metadata only, no inverse. `revertAction` replays through an in-memory, session-only replay capability (`src/modules/Command/stores/actionReplayCapabilities.ts`, bounded to the newest 200 entries) and returns `unavailable` when none exists, for example after a reload.
2. **Collaboration is a byproduct, not a feature.** Concurrent editors merge through the same document, so multi-user editing reuses the single-user write path exactly. The price of admission is rule 1: everything goes through the funnel.

## 2. Ownership: CrdtDocument vs. Collaboration

These two modules are easy to conflate. The split:

| Concern              | Owner                        | Examples                                                                                                                    |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Document lifecycle   | CrdtDocument                 | create/load/save, compaction, branches (`crdtBranching/`), merge (`crdtMerge/`), semantic action history, persistence queue |
| Projections          | CrdtDocument                 | `projection/projectProjection.ts`, `setupProjectionBridge.ts` — document → stores                                           |
| File format          | CrdtDocument                 | `.sdaw` encode/decode (`useCases/sdawFileFormat/`), native persistence (`repositories/nativeCrdtPersistence/`)              |
| Transport & sessions | Collaboration                | WebRTC peers, invites/QR, presence, cursors, asset transfer                                                                 |
| LAN discovery        | Collaboration + `daw-collab` | mDNS advertise/browse, `collab_*` commands                                                                                  |

A useful test: if the code would still make sense with no network in the world, it belongs to CrdtDocument; if it would still make sense with no document, it belongs to Collaboration.

## 3. Persistence

**In the browser**, CRDT-backed stores persist through the Automerge storage adapter (`src/infra/store/storage/createAutomergeStorage.ts`) — the same pluggable `StorageAdapter` slot used by memory and localStorage adapters, so a store's persistence backend is a wiring decision, not a code change.

**Natively**, the `daw-collab` crate owns the `.sdaw` bundle format (`crates/daw-collab/src/persistence.rs`):

```text
4B  magic "SDAW"
2B  format version (u16)
..  per-document Automerge saves
```

TypeScript encode/decode lives in `CrdtDocument/useCases/sdawFileFormat/` (`encodeSdawFile.ts`, `decodeSdawFile.ts`). Filesystem access is repository-layer only (`repositories/nativeCrdtPersistence/`) — components never touch project files.

## 4. The three transports

Collaboration ships three independent connectivity paths. They share the document model and nothing else:

1. **Serverless WebRTC.** Manual offer/answer exchange, with QR-code invites (`qrcode` dependency) for phone-to-desktop pairing. `Collaboration/repositories/peerConnection.ts` wraps raw `RTCPeerConnection`; `generateInvite.ts` / `acceptAnswer.ts` drive the handshake. No server involved — signaling is copy-paste or camera.
2. **WebSocket relay.** A standalone package at repo-root `server/` (`sourdaw-collab-server`): a small `ws` relay on port 8787 handling session/peer registry, host migration, and the message types `join/leave/action/cursor/sync-request/sync-response/state-update`. It is deliberately _not_ in the pnpm workspace (own `package-lock.json` and tsconfig); `scripts/health-gates-server.sh` builds it during explicit full validation. Startup requires a 32–128 character base64url `COLLAB_AUTH_TOKEN`; clients send `sourdaw` and that token as WebSocket subprotocols. That token admits a client to the relay; it does not admit it to a room. Room membership is a separate per-session capability: `join` carries the `sessionSecret` the invite minted, the relay stores the creator's and compares every later joiner's in constant time. Naming a session id therefore admits nobody by itself. Every client-supplied identifier is capped in bytes before it can key a map. The relay binds `127.0.0.1` unless `COLLAB_HOST` is explicitly set, and refuses to start on a non-loopback host in cleartext: serve TLS by setting both `COLLAB_TLS_CERT` and `COLLAB_TLS_KEY`, or accept an unencrypted bind explicitly with `COLLAB_ALLOW_CLEARTEXT=1`. Connection, session, peer, payload, rate, and outbound-buffer limits are configurable.
3. **Native LAN.** The `daw-collab` crate advertises and browses mDNS (`_sourdaw._tcp.local.`) and exposes session management through the `collab_*` native commands (create/save/load/merge/apply + advertising/browsing lifecycle).

## 5. Invariants

- **Serializable truth only.** No runtime handles (AudioContext, nodes, worklets, plugin instances, editor windows) in the document or CRDT-backed stores. Automerge must serialize and merge every value.
- **Projections are disposable.** Stores fed from the document are derived views. Rebuild them; never patch them by hand; never treat them as truth.
- **Semantics travel with actions.** Automerge guarantees convergence, not meaning. The semantic context attached at dispatch time is what makes document history reviewable; the inverse captured at dispatch time is what makes undo sane.
- **One owner per write.** Cross-feature intent goes through `executeAppAction`; subscribers react, they do not become writers.

## References

- `.agents/skills/crdt-collaboration/SKILL.md` — operational rules for this system
- `src/modules/Collaboration/AGENTS.md` — transport-layer detail
- `docs/03-state-management.md` — store mechanics
