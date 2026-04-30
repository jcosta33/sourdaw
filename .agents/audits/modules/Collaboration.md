# Collaboration module audit

## Scope

Adversarial review of `src/modules/Collaboration/` in full — every file under
`useCases/`, `handlers/`, `repositories/`, `models/`, `stores/`, `errors/`,
`events/`, `presentations/`, and their `__tests__/` siblings. Boundary code
that the module imports from `CrdtDocument`, `Arrangement`, `AudioEngine`,
`Transport`, `Workspace`, and `Command` is read-only context — not under audit
unless directly imported by a Collaboration file.

It is an adversarial review, with emphasis on:

- CRDT (Automerge) integration correctness and sync-loop semantics
- Presence / awareness leaks (heartbeat, expiry, broadcast filtering)
- WebRTC connection / reconnect logic (no WebSocket signaling — manual SDP
  copy-paste) and ICE failure modes
- Conflict-resolution edge cases (per-peer SyncState, branch-doc projection)
- Auth-token / role lifecycle (host-granted roles, no enforcement)
- Architectural-boundary violations, type soundness, React anti-patterns,
  test laziness, accessibility

Related spec: none on disk.

---

## Goal

A correctness-first, contract-driven collaboration surface:

- A single canonical session lifecycle: `createSession` / `joinSession` /
  `acceptAnswer` / `leaveSession`, with idempotent, race-safe teardown and
  startup. No leaked timers, no dangling subscriptions, no drift between
  `collaborationStore` and the underlying `RTCPeerConnection`s.
- Presence is ephemeral, peer-scoped, expires deterministically, and never
  bleeds across sessions or after `leaveSession` returns.
- WebRTC: ICE failure surfaces to the UI as a discoverable error, not a
  silently dropped connection. Manual-signaling flow distinguishes
  expired / reused / forged invites. There is a clear story for "host
  closes laptop" — peers either reconnect or are released.
- CRDT sync: per-peer per-doc `SyncState` is correct, malformed messages
  cannot corrupt local docs, branch metadata cannot leak between
  sessions, and `subscribeToCrdtChanges` does not feed our own changes
  back into the network in a loop.
- Permissions: roles are granted by a verified host, capabilities are
  enforced at the **edit** boundary (not just queryable on the read side),
  and revocation has a defined epoch / reorder behaviour.
- Asset transfer: requested-only, integrity-verified, backpressure-aware,
  bounded memory usage; no DoS vector via unsolicited manifests.
- AGENTS.md hard rules: no `any` / `as never` / `as unknown` escapes, no
  `useMemo`/`useCallback`/`React.memo`/`forwardRef`, no `&&` rendering,
  no namespace imports, single-object-arg signatures, one function per
  `useCases/`/`repositories/` file, public surface only at `index.ts`.

---

## Relevant code paths

- `src/modules/Collaboration/` (root — **no `index.ts` exists**)
- `src/modules/Collaboration/useCases/index.ts`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts`
- `src/modules/Collaboration/useCases/automergeSync.ts`
- `src/modules/Collaboration/useCases/assetTransfer.ts`
- `src/modules/Collaboration/useCases/permissions.ts`
- `src/modules/Collaboration/useCases/collaborationQueries.ts`
- `src/modules/Collaboration/useCases/getCollaborationHandlers.ts`
- `src/modules/Collaboration/handlers/collaboration/handleCreateCollabSession.ts`
- `src/modules/Collaboration/handlers/collaboration/handleJoinCollabSession.ts`
- `src/modules/Collaboration/handlers/collaboration/handleLeaveCollabSession.ts`
- `src/modules/Collaboration/repositories/peerConnection.ts`
- `src/modules/Collaboration/stores/collaborationStore.ts`
- `src/modules/Collaboration/models/CollaborationTypes.ts`
- `src/modules/Collaboration/models/syncChannelConstants.ts`
- `src/modules/Collaboration/errors/CollaborationError.ts`
- `src/modules/Collaboration/events/index.ts` (empty)
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/Collaboration/presentations/views/PresenceOverlay.tsx`
- `src/modules/Collaboration/presentations/views/QrInvite.tsx`
- `src/modules/Collaboration/presentations/views/index.ts`
- `src/modules/Collaboration/presentations/components/*.tsx`
- `src/modules/Collaboration/presentations/hooks/useCollaborationState.ts`
- `src/modules/Collaboration/presentations/hooks/usePresence.ts`
- All `__tests__/` siblings of the above

---

## Current behavior

**Module shape.** There is **no root `index.ts`** for `Collaboration/`.
Cross-module consumers reach in via `#/modules/Collaboration/useCases`,
`#/modules/Collaboration/stores`, and
`#/modules/Collaboration/presentations/views`. AGENTS.md describes the
module's "root `index.ts`" as the canonical cross-module surface — this
module simply doesn't have one (verified at module root: only
`errors/`, `events/`, `handlers/`, `models/`, `presentations/`,
`repositories/`, `stores/`, `useCases/`).

**Session lifecycle.** `createSession` / `joinSession` / `acceptAnswer` /
`leaveSession` live in `useCases/collaboration/sessionManagement.ts:261-598`
inside an 820-line file. All session-scoped mutables (peer manager,
automerge sync, asset transfer, permission manager, projection bridge
cleanup, presence listeners, playhead broadcast interval, pending invite
id, branch snapshot, branch subscriptions, projection guard,
projected-branches JSON cache) coalesce into a single `sessionState`
holder constant (`:58-100`).

**Manual-signaling WebRTC.** Invites are `RTCSessionDescription` JSON +
host metadata, deflate-raw compressed and base64-prefixed `z:`
(`:796-820`). Joiners produce an answer and the host pastes it back
through `acceptAnswer`. There is no WebSocket / signaling-server
component despite `SignalingMessage` types implying one
(`models/CollaborationTypes.ts:47-49`).

**Per-peer connection.** `repositories/peerConnection.ts:47-225` wraps a
single `RTCPeerConnection` with two `RTCDataChannel`s (`crdt-sync`
reliable+ordered, `presence` unreliable+`maxRetransmits: 0`). ICE
gathering blocks invite generation up to 10 s
(`peerConnection.ts:170-192`). On `connectionState === 'disconnected' |
'failed'` the manager emits `onDisconnected`; there is **no
reconnection logic** — `failed` is treated as a clean close.
`PeerConnectionManager` (`:230-308`) keeps a `Map<PeerId,
PeerConnection>` and provides broadcast methods.

**CRDT sync.** `useCases/automergeSync.ts` keeps a per-peer
`Map<docId, SyncState>` and reacts to local document changes via
`subscribeToCrdtChanges`. On change, it generates sync messages for
each peer per doc; on receipt, it `replaceCrdtDoc` and persists. The
hint-aware "fast path" (single doc) is at `:55-66` and `:195-199`.

**Branch metadata.** `startBranchSync` / `stopBranchSync`
(`sessionManagement.ts:125-229`) creates a session-scoped
`__branches__` Automerge doc (host) or initialises empty (joiner),
mirrors `branchStore` mutations into the doc, and projects incoming
doc updates back into `branchStore`. A re-entrancy guard
(`isProjectingBranches`) and a JSON-equality cache prevent the obvious
loop. On session end the doc is removed and the pre-session branch
snapshot is restored.

**Asset transfer.** `useCases/assetTransfer.ts` runs over the same
reliable channel via the `__asset__` pseudo-doc-id route. Manifests +
chunks (256 KiB) are pushed by the holder; integrity is checked via
SHA-256 reverse-hash on assemble. There is **no manifest-without-request
guard** — incoming manifests start a transfer slot regardless of whether
this peer asked for the asset.

**Permissions.** `useCases/permissions.ts` keeps an in-memory `Map<PeerId,
RoleGrant>` with monotonically increasing epoch. Hosts grant; receivers
filter incoming role-grant messages by checking the **sender** is the
host **as recorded in our local peer list**. **No capability check is
ever performed at the edit / sync boundary** — `canEdit` /
`canControlTransport` exist but **no caller invokes them**.

**Presence.** `broadcastPresence` (sessionManagement.ts:603-622) merges
`peerId` / `name` / `color` into the supplied `PresenceData` and broadcasts
over the unreliable channel. Host runs a 4 Hz `setInterval`
(`PLAYHEAD_BROADCAST_HZ`) emitting a degenerate presence with
zeroed/null view fields just to push playhead position
(`startPlayheadBroadcast`, `:536-565`). `usePresence` ref-counter hook
(`presentations/hooks/usePresence.ts`) subscribes via `onPresence`,
mutates a ref, and bumps a version counter to trigger re-renders.
Entries expire after 5 s of silence.

**Tests.** Spec coverage exists for every public file. The deepest
spec, `sessionManagement.spec.ts`, mocks every dependency wholesale
and exercises only `createSession` / `leaveSession`. `peerConnection.ts`
has **no spec at all**. `permissions.spec.ts` does not exercise the
`role.grant` receive-path (sender-is-host filter, epoch reorder).
`assetTransfer.spec.ts` does not exercise `handleManifest` /
`handleChunk` / `assembleAsset` / hash-mismatch.

---

## Findings

1. **The module has no root `index.ts` cross-module surface.** Every
   consumer outside the module reaches into the second-level barrels
   (`/useCases`, `/stores`, `/presentations/views`). AGENTS.md
   ("**Contract Boundaries**") expects "the destination module's root
   `index.ts`". There is no aggregate barrel that would let a future
   consumer write `import { ... } from '#/modules/Collaboration'`. The
   `events/index.ts` (`// no public events`) confirms intentional
   shape — but the missing root barrel means the contract is fragmented
   across three sub-barrels and not enforceable as a single import path.

2. **`useCases/collaboration/sessionManagement.ts` is 820 lines and is a
   single file with ~25 functions.** AGENTS.md says "**One Function Per
   File:** every `useCase` and `repository` file must export exactly ONE
   function." This file exports **9** named functions plus dozens of
   internal helpers and the `sessionState` holder. It is the single
   biggest violation of the use-case shape rule in the module.

3. **Permissions are advertised but never enforced.** `permissions.ts`
   exposes `canEdit` / `canControlTransport` / `hasCapability`. Nothing
   in the codebase calls them — verified by `grep -rn 'canEdit\|canControlTransport\|hasCapability' src` returning only the
   definition site and its own test. `PermissionManager.handleMessage`
   accepts grants from the **stored host** (the peer who first connected
   and was added with `isHost: true`) and updates local grants — but no
   downstream code looks at those grants when projecting Automerge
   patches into local stores. **A "viewer" peer can still mutate
   `trackStore` via Automerge sync messages**; the role system is
   theatre. (`useCases/permissions.ts:65-104`; absence of callers
   verifiable by grep.)

4. **`PermissionManager.handleMessage` accepts a forged host grant in
   the host-loses-peer race.** `handleMessage` checks
   `state?.peers.find(p => p.id === peerId && p.isHost)`
   (`permissions.ts:122`). If a malicious peer sends a `peer-info`
   with `isHost: true` (the `peer-info` route in
   `sessionManagement.ts:662-663` calls `addOrUpdatePeer(message.peer)`
   with **no validation**), they are added with `isHost: true` and from
   that moment can issue `role.grant` messages and mutate every other
   peer's role table. Only the **local** state's stored host flag is
   ever consulted; trust is established by self-declaration. Combined
   with #3 this is academic, but if #3 is fixed without fixing this, a
   peer can promote themselves to host in everyone else's view.

5. **`peer-info` and `peer-leave` are unauthenticated.** Anyone with a
   data-channel connection can broadcast `{ type: 'peer-info', peer:
   { id: '<other-peer-id>', isHost: true, ... } }` or `{ type:
   'peer-leave', peerId: '<other-peer-id>' }`, and the receiver will
   blindly mutate `collaborationStore.peers` (`sessionManagement.ts:715-743`).
   `peer-leave` lets a malicious peer eject any other peer from the
   local view — and `removePeer` calls `peerManager.removePeer(peerId)`
   which closes the underlying connection. **A single hostile joiner
   can disconnect the entire mesh from each other peer's perspective.**

6. **Per-peer `SyncState` is keyed by docId but `replaceCrdtDoc` does
   not invalidate the sync state.** `automergeSync.receiveSync`
   computes the new doc with `receiveSyncMessage(doc, syncState,
   syncMessage)` and stores `[newDoc, newSyncState]`. Then
   `replaceCrdtDoc({ id, doc: newDoc })` calls
   `automergeRepository.notifyListeners(id)` (verified
   `CrdtDocument/repositories/automergeRepository.ts:187-190`), which
   re-enters our own listener via `subscribeToCrdtChanges` →
   `sendDocSyncToAllPeers`. That now generates an outgoing sync message
   for **every peer including the one we just received from**, using
   the just-mutated `syncState` for the originator. Automerge's protocol
   tolerates this, but it doubles the per-update sync bandwidth and
   creates a tight ping-pong if two peers receive in rapid succession.
   There is no flag like "currently applying remote sync — skip
   broadcast" — verified by reading `start()` and `receiveSync()` in
   their entirety.
   (`useCases/automergeSync.ts:54-66, 88-130`)

7. **`receiveSync` `persistCrdtProject().catch(...)` swallows write
   failures.** `automergeSync.ts:127-129` catches and logs but does not
   surface the error to the user or `collaborationStore.error`. If
   IDB persistence is failing (quota, locked, etc.) the user has no
   indication; their session continues to receive remote changes that
   live only in memory until the tab is closed.

8. **Branch sync projects without verifying the host's authority.**
   `startBranchSync` (joiner side) lets the **first incoming sync
   message for `__branches__`** create the doc and project its content
   into local `branchStore`, replacing the local snapshot
   (`sessionManagement.ts:162-195`, `automergeSync.ts:99-104`). Any
   peer can broadcast a `crdt-sync` for `__branches__` and have it
   accepted as the canonical branch list. Combined with #5 this means a
   joiner with editor rights can rewrite every other joiner's branches.
   The `__permissions__` route at least filters by stored-host —
   `__branches__` does not.

9. **Branch snapshot restore-on-leave is best-effort and racy.**
   `stopBranchSync` (`sessionManagement.ts:202-229`) restores
   `branchStoreSnapshot` then asynchronously calls `persistCrdtProject()`.
   If `leaveSession` is followed by an immediate process exit (tab close)
   the persisted state contains the **session-time** branches, not the
   restored snapshot. Worse, the snapshot itself is taken with
   `{ ...branchStore.value, branches: [...branchStore.value.branches] }`
   — a shallow array clone; the branch records inside (which are
   `LocalBranchRecord` objects holding `createdFromHeads: string[]`)
   share references with the live store. If branch records mutate during
   the session (even though "branches" are nominally immutable), the
   snapshot would mutate too. (`sessionManagement.ts:127-129, 217`.)

10. **Module-level `peerCleanupTimers` map outlives sessions.**
    `peerCleanupTimers` is a top-level `const` (`sessionManagement.ts:103`).
    `cleanupSubsystems` clears it (`:470-473`). But on `handlePeerDisconnected`
    the cleanup timer is set with `peerCleanupTimers.set(peerId, timer)`
    (`:704`) and references local `removePeer(peerId)` which closes over
    `collaborationStore`. If `leaveSession` runs **before** the
    15-second timer fires, the timer remains scheduled (because the
    `cleanupSubsystems` order is `stopPlayheadBroadcast → stopBranchSync →
    clear cleanup timers → automergeSync.stop → ...`, and **clear is
    via `for (const timer of peerCleanupTimers.values()) clearTimeout`** —
    so this is OK on the **`leaveSession` path**, but **not** on the path
    where `createSession` calls `cleanupSubsystems()` first thing
    (`:262-263`). Wait — re-read: `cleanupSubsystems` _does_ clear them at
    `:470-473`. **Verified safe.** **However** the cleanup timer's
    `removePeer` callback closes over the live `collaborationStore`,
    so if a new session starts and a 15 s peer-cleanup callback from a
    **previous** session somehow leaks (e.g. an exception thrown
    between `peerCleanupTimers.set` and `cleanupSubsystems` running),
    the new session's peer list is mutated by stale data. No defence in
    depth (e.g. capture session id and bail if changed) is implemented.

11. **`collaborationStore.set({ ..., peers: [...] })` updates lose
    other-field changes when racing.** `addOrUpdatePeer`,
    `removePeer`, `updatePeerLastSeen`, `updatePeerConnectionState`,
    `handlePeerConnected` and `handlePeerDisconnected` each call
    `collaborationStore.set({ ...state, ... })` after a fresh
    `collaborationStore.value` read. They are not atomic. If two
    handlers fire synchronously in JS (e.g. `peer-info` arrival with
    `presence` arrival inside the same microtask flush from the
    data channel), one of the writes is lost — last write wins on
    `peers`, `connectionStatus`, etc. The store API used is "spread +
    set" with no transactional update. This is a classic Zustand-style
    foot-gun and the code is sprinkled with it.
    (`sessionManagement.ts:691, 710, 723-729, 738-743, 751-754, 761-767`.)

12. **Presence broadcast in `startPlayheadBroadcast` ignores in-flight
    presence and overwrites cursor / selection state to nulls / empty
    arrays.** `startPlayheadBroadcast` broadcasts with `cursorBeat:
    null, cursorTrackId: null, selectedClipIds: [], selectedNoteIds:
    [], viewportStartBeat: 0, ..., action: null` 4 times per second
    (`sessionManagement.ts:546-563`). Receivers via `usePresence`
    merge with `existing ? { ...existing, ...data } : data`
    (`presentations/hooks/usePresence.ts:31`), so the playhead-only
    broadcast **wipes** the receiver's cached cursor position, track
    selection, and viewport. On the receiver side, the cursor disappears
    every 250 ms and only reappears when the sender's mouse moves.
    **This is the user-visible flicker bug with cursors.**

13. **`broadcastPresence` over the unreliable presence channel happens
    even before the connection is open.** `peerManager.broadcastPresence`
    iterates `peers` filtered by `peer.isReady()` (peerConnection.ts:282-288)
    — but `isReady()` checks only `crdtChannel.readyState === 'open'`
    (`:153-155`). The presence channel may not be open yet. The
    `sendPresence` method then does its own `presenceChannel?.readyState
    === 'open'` check (`:146-150`) so a no-op is the worst case — but
    this means the host's playhead is silently dropped during the
    ~50 ms window between crdt-sync open and presence open. Not
    user-visible; flagged as a contract sloppiness.

14. **`onPresence` listeners fire on every incoming presence with no
    filtering for self-broadcasts**, but the dispatch path is
    `peer-side broadcastPresence → peer-side sendPresence → peer A's
    data channel → peer B's onmessage → callbacks.onMessage →
    handlePeerMessage → presenceListeners.forEach`. There is no path
    for self-presence to land back, so **OK** in practice — the failure
    mode is in #12. Listed as confirmation, not as an issue.

15. **`updatePeerLastSeen` is called on _every_ presence message
    (4 Hz × peers + cursor moves at 10 Hz) and rewrites the entire
    `peers` array.** `sessionManagement.ts:745-754`. With 5 peers
    sending presence at 14 Hz combined this is ~70
    `collaborationStore.set` calls per second, each a full peers-array
    map. Subscribers (e.g. `useCollaborationState`) re-render the panel
    on every one. The presentation tier doesn't care about
    sub-second `lastSeen` precision; rewrite to a per-peer
    map or throttle to 1 Hz. (Equivalent to AudioAnalysis audit issue
    #5 in flavour.)

16. **`PresenceOverlay` re-creates `dataRef.current = {}` on
    `usePresence` cleanup but the version counter is not reset.**
    `usePresence` (`presentations/hooks/usePresence.ts:50-57`) clears
    the timers and the data ref but leaves `version` at its incremented
    value. If the hook re-mounts (e.g. arrangement view toggled), the
    next `setVersion(v => v + 1)` continues from the prior count. Not a
    bug per se — but the comment "React Compiler memoizes this across
    renders with the same version" relies on monotonic version counts
    matching presence updates, and a hook re-mount with a stale version
    will cause the very first `setVersion` after mount to fire **with a
    version equal to the last unmount value + 1**, which the React
    Compiler may consider unchanged from the prior render's snapshot.
    Use `setVersion(0)` on cleanup or convert to `useReducer`.

17. **`usePresence` returns `Object.values(dataRef.current)` directly
    on every render.** `presentations/hooks/usePresence.ts:64-66`. The
    `void version;` line tells the React Compiler that `version` is a
    dependency, but the actual returned array is a fresh `Object.values()`
    call — a new reference every render. Components using this output
    in `useEffect` deps or downstream `===` comparisons will treat
    every update as a change. With React Compiler this is supposed to
    be auto-memoized, but the data layout (mutable ref backing
    + version-number trigger) is brittle: `Object.values` returns the
    **values** in the **insertion order** at call time, which the
    compiler cannot prove stable across versions.

18. **`PresenceOverlay` doesn't guard against `presence.cursorTrackId`
    referring to a deleted track.** `trackIdToY(trackId)` may return
    `null` (`presentations/views/PresenceOverlay.tsx:31`); the check
    after handles `null`. But if the track existed when the peer sent
    the presence and was deleted before ours rendered, the dot is
    silently hidden. Acceptable. Flagged for completeness.

19. **`peerConnection.ts:waitForIceGathering` resolves on **timeout**
    after 10 s with a partial SDP.** `peerConnection.ts:170-192`. If
    ICE gathering hasn't completed by 10 s (e.g. behind symmetric NAT
    waiting for TURN that isn't configured), the host generates an
    invite with **only the candidates gathered so far** — possibly
    missing the candidate that would have worked. The user gets no
    indication that the invite is degraded. There is no surfaced error
    state for "ICE gathered nothing useful" or "all candidates are
    host-only — NAT will block".

20. **No reconnection on `connectionState === 'failed'`.**
    `peerConnection.ts:61-68`: on `disconnected | failed`, callbacks fire
    `onDisconnected` and the `peerCleanupTimer` (15 s) eventually
    `removePeer`s. There is no attempt at ICE restart
    (`pc.restartIce()`), no exponential-backoff retry, no UI indication.
    A transient network blip (Wi-Fi flap, VPN reconnect) terminates the
    session. Combined with the manual-signaling flow, the only way to
    re-establish is to generate and exchange a fresh invite.

21. **`acceptAnswer` removes the pending invite id even if
    `acceptAnswer` rejects.** `sessionManagement.ts:443-444`: if
    `peer.acceptAnswer(answer.sdp)` succeeds, `pendingInviteId` is
    cleared. If it throws, the catch block in
    `CollaborationPanel.handleAcceptAnswer` logs and the
    `pendingInviteId` is **still set** (because `acceptAnswer` threw
    before the `pendingInviteId = null` line). A subsequent
    `generateInvite()` call calls
    `peerManager.removePeer(pendingInviteId)` and `pendingInviteId =
    null` (`:317-320`) — so the orphan is cleaned next time. **OK**,
    but the invariant is implicit. More importantly: `acceptAnswer`
    has no validation that `answer.pendingPeerId` actually belongs to
    the **active host** session — a forged `answer` with any prior
    pending peer id will succeed.

22. **`generateInvite` and `joinSession` cannot fail safely if a prior
    invite is in flight.** `generateInvite` (`:311-338`) closes the
    previous pending peer before creating a new one
    — but if the previous joiner managed to send their answer **between**
    `removePeer` and `peerManager.createPeer(joinerPeerId)` (e.g. via a
    pending dispatch), the data is lost. The pending pair is recreated
    with a new `joinerPeerId`. The old joiner's answer (with the old
    `pendingPeerId`) will then fail in `acceptAnswer` ("No pending peer
    connection matches this answer"). The UI message ("the invite may
    have expired") is misleading — the invite was overwritten by the
    host clicking "Copy Invite" again.

23. **Invite compression loses fidelity for old peers via the `z:`
    prefix.** `compressInvite`/`decompressInvite`
    (`sessionManagement.ts:796-820`) marks compressed payloads with
    `z:` and falls back to `atob` for unprefixed ones (legacy
    uncompressed). If a future client sends an invite that is plain
    base64 starting with `z:` (cryptographically possible), the
    legacy-detect fails. More immediately: if the compressed payload
    contains binary data that base64-encodes to a string starting with
    `z:`, the `'z:'` prefix is part of the data, not a compression flag
    — but compressed bytes are deterministic and start with a deflate-raw
    block header (typically high bytes), so base64-encoding rarely
    starts with `z`. Documented gotcha; not exploitable.

24. **`compressInvite` uses `btoa(String.fromCharCode(b)...)` over a
    raw byte stream.** `sessionManagement.ts:803`. Building a string
    via `Array.from(result, b => String.fromCharCode(b)).join('')` for
    each byte allocates O(n) intermediate strings; for a 6 KB SDP this
    means 6 000 single-char strings + a join. There is a `bytesToBase64`
    helper imported by `automergeSync.ts` and `assetTransfer.ts` (via
    `#/utils/base64`) that's used elsewhere — this file does not use
    it. (`sessionManagement.ts:1` imports `logger` only.)

25. **`AssetTransfer.handleManifest` creates a transfer slot for any
    incoming manifest.** `assetTransfer.ts:163-173`. A peer can
    spam `asset.manifest` messages with arbitrary `chunkCount` /
    `size` values, causing the receiver to allocate `incomingTransfers`
    entries unbounded. Combined with `asset.chunk` messages, an
    attacker can fill the receiver's memory with `Map<number,
    Uint8Array>` entries. There is no rate limit, no maximum manifest
    size, no maximum number of in-flight transfers, and no
    confirmation that this peer requested the asset.

26. **`AssetTransfer.handleAssetRequest` blindly serves any request,
    even from a peer with role `viewer`.** `assetTransfer.ts:110-161`.
    With permissions never enforced (#3), any peer can request any
    asset by hash. The only "filter" is that the receiver must have the
    asset locally. There is no role check, no rate limit, no per-peer
    inflight cap. With the 256 KiB chunk size and the
    `sendCrdtSyncBuffered` HIGH_WATER_MARK of 256 KiB
    (`peerConnection.ts:128`), a single peer can saturate the host's
    upload bandwidth by repeatedly requesting a large asset.

27. **`AssetTransfer.assembleAsset` integrity check uses SHA-256 over the
    same bytes that were chunked, but rejects without retry / explanation.**
    `assetTransfer.ts:219-225`. On hash mismatch the transfer is
    silently deleted (`logger.warn` is the only signal). The peer that
    requested the asset is left in a stuck state — the original
    `requestAsset` returns immediately and there is no completion
    callback / error path. The clip whose `assetHash` referenced this
    asset will never decode.

28. **`asset.request.missingChunks: number[]` is advertised in the
    protocol but never set.** `assetTransfer.ts:75-87` always sends
    `missingChunks: []`, which `handleAssetRequest` interprets as "send
    everything" (`:137-138`). The "bitmap-based resume" mentioned in
    the comment at `:31-34` is documented but unimplemented. A peer
    re-requesting an asset after a partial transfer will receive the
    full asset again, and a peer with a partial transfer slot will
    accept duplicate chunks (the `Map<index, Uint8Array>` write is
    idempotent but wasteful).

29. **`requestAsset` is **broadcast** to all peers, every peer sends
    the full asset back.** `assetTransfer.ts:75-87` calls
    `broadcastCrdtSync`. If 5 peers all have the asset, the requester
    receives 5 manifests and the host sends 5 × full-asset bandwidth.
    There is no "first responder wins" or "send manifest only, request
    chunks afterward" arbitration. Combined with #25 / #26 this is
    O(N²) bandwidth in the peer count for a single asset.

30. **`hashBlob` uses `crypto.subtle.digest('SHA-256')` but the asset
    transfer comments (`assetTransfer.ts:31-34`) and the type prefix
    (`sha256:`) advertise BLAKE3 as the future plan.** SHA-256 over the
    full blob blocks the main thread on `arrayBuffer()` for large
    files; for a 50 MB recording this can take seconds. No
    `OffscreenCanvas` / Worker offload; no incremental hash.

31. **`AssetTransfer.handleMessage` is async but the routing in
    `handlePeerMessage` discards the Promise.**
    `sessionManagement.ts:651`: `void sessionState.assetTransfer?.handleMessage(...)`.
    Errors in `handleMessage` (chunked send failures inside
    `handleAssetRequest`) become unhandled promise rejections —
    actually no, `handleMessage` itself catches and logs
    (`assetTransfer.ts:105-107`), but `handleAssetRequest`'s
    `await sendCrdtSyncBuffered` rejections propagate to the caller and
    are caught by the **outer** try/catch as a logger.warn. The
    message that triggered the send is silently lost; the requester
    waits forever.

32. **`AutomergeSync.receiveSync` will silently create branch / arbitrary
    docs that the local node never asked for.**
    `automergeSync.ts:99-104`: if the message references a `docId` we
    don't have, we `createCrdtDoc(docId)` and let the sync message
    fill it in. A malicious peer can broadcast `crdt-sync` messages
    for `docId: 'evil_doc'` and the local repository accepts a new
    document with arbitrary content. Combined with `getCrdtDocIds()`
    being included in `sendSyncToPeer` (`:150-154`, but only
    `branch_*` docids), the doc remains in memory and is persisted by
    the next `persistCrdtProject` call. **Local persistence is
    unbounded by remote-message volume.**

33. **`AutomergeSync.start()` calls `this.unsubscribeFromChanges =
    subscribeToCrdtChanges(...)` but `start()` may be called more than
    once.** `automergeSync.ts:53-66`. There is no guard against double
    `start()`; the second call overwrites `this.unsubscribeFromChanges`
    without unsubscribing the first. Not currently triggered by the
    use-case layer (`createSession` and `joinSession` both call
    `cleanupSubsystems()` before constructing a new `AutomergeSync`),
    but it's a foot-gun if a future caller restarts.

34. **`automergeSync.removePeer` does not flush queued sync messages.**
    `automergeSync.ts:84-86` deletes the per-peer state but any
    in-flight `sendDocSyncToPeer` calls (e.g. queued from a recent
    local change) will see `peerStates = this.syncStates.get(peerId)
    ?? new Map()` and proceed to call
    `peerManager.sendCrdtSync({ peerId, message })` for a peer that no
    longer exists. `peerManager.sendCrdtSync` then calls
    `this.peers.get(peerId)?.sendCrdtSync(message)` and silently
    no-ops. This is technically "OK" but the error path is masked —
    a debugging session can't tell whether sync messages are being
    sent or dropped.

35. **Test for `automergeSync` exercises only `start()` and asserts
    that `subscribeToCrdtChanges` was called.**
    `useCases/__tests__/automergeSync.spec.ts:22-34`. There is no test
    for `receiveSync`, `addPeer`, the malformed-message catch,
    `replaceCrdtDoc` integration, the bulk-vs-per-doc sync path
    (issue #33), or the `branch_*` enumeration in `sendSyncToPeer`.
    The `peerManager` is `as never` (#36).

36. **Tests use `as unknown as` / `as never` to type-cast partial
    fixtures.** AGENTS.md "TypeScript — soundness" forbids these.
    - `useCases/__tests__/automergeSync.spec.ts:29` `peerManager as never`
    - `useCases/__tests__/assetTransfer.spec.ts:12, 52` `as unknown as PeerConnectionManager`, `as never`
    - `useCases/__tests__/permissions.spec.ts:27` `as unknown as PeerConnectionManager`
    - `useCases/collaboration/__tests__/sessionManagement.spec.ts:122` `as unknown as typeof mocks.collaborationStoreValue.value`

37. **Tests for `CollaborationPanel` are no-ops — every test renders the
    same component with identical mocks and asserts `document.body`.**
    `presentations/views/__tests__/CollaborationPanel.spec.tsx:15-34`.
    All four tests are functionally identical. There are no
    interaction assertions (host name input → button click →
    `createSession` called), no error-state coverage, no coverage of
    the host vs joiner branches.

38. **Tests for `QrInvite`, `PresenceOverlay`, `PresenceMarker`,
    `PresenceLabel`, `CollaborationStatusRow`, `CollaborationBlock`,
    `PeerPresenceRow`, `InviteCodeRow` are all "smoke" — render and
    assert text / aria.** No interaction tests for invite-too-long
    fallback (`QrInvite.tsx:64-79`), no `clearTimeout` assertions, no
    keyboard-accessibility assertions.

39. **`peerConnection.ts` has no tests.** The most security-sensitive
    file in the module — handles SDP parsing
    (`JSON.parse(answerSdp) as RTCSessionDescriptionInit`,
    `peerConnection.ts:96, 106`), data-channel routing, ICE gathering
    timeout, and channel state machine — is uncovered. JSON.parse
    rejections in `acceptOffer` / `acceptAnswer` are unhandled and will
    propagate as raw `SyntaxError`s through the `acceptAnswer` /
    `joinSession` path; the UI's `catch` shows `logger.warn(error)` but
    never sets `collaborationStore.error`.

40. **`PeerConnectionManager.createPeer` silently closes any existing
    peer with the same id.** `peerConnection.ts:240-246`. If host A
    has `peer-X` connected and a new joiner is assigned `peer-X` (by
    `pendingInviteId` collision — extremely unlikely with crypto.randomUUID,
    but possible if a future change shrinks the id), the existing
    connection is closed without emitting `onDisconnected`. The
    consumer never learns the connection died.

41. **`SignalingMessage.pendingPeerId` is required for `answer` but
    optional in spirit.** `models/CollaborationTypes.ts:48-49`. If the
    joiner does not echo back the host's `pendingPeerId` (a custom
    client could omit it), the host's `acceptAnswer` looks up
    `getPeer(undefined)` which returns `undefined`, the user sees
    "No pending peer connection matches this answer". This is
    well-handled, but no validation rejects an invite with
    `type: 'answer'` carrying a non-existent `pendingPeerId` early —
    the error is generic.

42. **`generateInvite` clobbers the previous pending invite without
    notifying the user.** `sessionManagement.ts:316-320`. The host
    might generate an invite, copy it, share it via a slow channel
    (Slack), and then click "Copy Invite" again to grab a "fresh
    copy". Now the original invite they shared is dead — the joiner
    sees "the invite may have expired" with no clue which generation
    they were on.

43. **`CollaborationPanel.handleAcceptAnswer` doesn't clear
    `inviteString` after accepting.** `CollaborationPanel.tsx:96-103`.
    The host can paste another joiner's answer into the same field
    and accept it, but the displayed "Copy Invite" string is now
    stale (the `pendingInviteId` was cleared on success). The UI
    shows the host can keep pasting answers, but the answers being
    pasted must correspond to the **currently displayed invite**.
    There is no visual feedback that the host needs to generate a
    new invite for the next joiner. (The `DawUtilityNotice` at `:242`
    says this in prose, but the input remains active.)

44. **`CollaborationPanel.handleCreate` is sync but creates a session
    that immediately tries to broadcast presence with no peers.**
    `sessionManagement.ts:289` calls `startPlayheadBroadcast()`. The
    interval starts a `setInterval` that runs every 250 ms regardless
    of peers; the early-return at `:538-540` short-circuits to no work
    when there are no connected peers. **OK**, but the interval is
    burning a timer for the entire host session even when no joiner
    has connected.

45. **`CollaborationPanel` `handleGenerateInvite` retry logic is
    missing.** If `generateInvite` rejects (e.g. RTCPeerConnection
    failed mid-creation), the user sees only `logger.warn`. The
    panel does not surface the error in the existing `state.error`
    field. (`CollaborationPanel.tsx:76-87`.)

46. **`CollaborationPanel` uses `useState` + `useRef` for two
    short-lived "Copied" timers.** Two distinct timers
    (`copiedInviteTimerRef`, `copiedAnswerTimerRef`) plus a third in
    `QrInvite.tsx:25`. A reusable hook (or a single
    `useTransientFlag` helper) would eliminate the duplication.
    AGENTS.md says local primitive state is `useState` — fine, but
    duplicated bookkeeping across three files is friction.

47. **`PresenceOverlay` doesn't render the local peer's presence.**
    Intentional — local users don't need their own ghost cursor — but
    in a multi-window setup (same user opens two tabs) the lack of
    self-filtering means each tab will broadcast its own presence and
    receive its own back via the data channel. **Wait —** WebRTC data
    channels don't echo, so this isn't observable, but if a user joins
    their own session twice (extremely unlikely manual flow), each
    tab is a separate peer with its own peerId, so no real bug.
    Flagged for completeness.

48. **`type CollaborationPeer = PeerInfo` re-export from `useCases/`.**
    `useCases/collaborationQueries.ts:4-6` exports `type
    CollaborationPeer = PeerInfo` and `export { type CollaborationState,
    PresenceData }`. AGENTS.md "**Use-case types stay private:** Do
    not `export type` from `useCases/` for other modules…" — the
    `useCases/index.ts` does **not** currently re-export these types
    (`useCases/index.ts:1-13`), so this is contained inside the
    module. **Compliant**, but if a refactor exposes
    `collaborationQueries` via a future root `index.ts` (as suggested
    by #1) the violation surfaces.

49. **Cross-module duplicate of the collaboration-state hook.**
    `src/modules/Collaboration/presentations/hooks/useCollaborationState.ts`
    and `src/modules/Workspace/presentations/hooks/useCollaborationState.ts`
    both subscribe to `collaborationStore` with locally-defined
    `defaultState` literals. The Workspace one re-types
    `peers: Array<{ id; name; color; isConnected; isHost }>` —
    intentionally duplicated per the model-isolation rule, but the two
    hooks are identical in shape and the duplication is uncommented.
    Per AGENTS.md "Model isolation" the duplication is correct; per
    DRY the file naming (`useCollaborationState`) at two paths is
    confusing.

50. **`startPlayheadBroadcast` has no guard for `transportStore` not
    yet initialised.** `sessionManagement.ts:545`:
    `transportStore.value?.playheadPosition ?? null`. If transport is
    initialising (e.g. async audio context unlock), playheadBeat is
    null — receiver renders no ghost playhead. **OK**.

51. **`leaveSession` broadcasts `peer-leave` over the **CRDT** channel
    (`broadcastCrdtSync`), not over presence**
    (`sessionManagement.ts:579-583`). This is correct — peer-leave is a
    persistent peer-list mutation — but combined with #5 it means a
    `peer-leave` from a malicious peer also goes through the reliable
    channel, ensuring delivery. Defence in depth would route
    peer-leave over a host-attestable path.

52. **`acceptAnswer` does not validate the incoming SDP fingerprint
    matches the offer's expected DTLS fingerprint.** WebRTC's DTLS
    handshake will fail if fingerprints mismatch, so a corrupted
    answer can't actually establish a channel — but the user sees
    a generic timeout / failure rather than "answer doesn't match
    invite". The `pendingPeerId` lookup is the only soft validation.

53. **`PEER_COLORS` has only 8 entries, with a fallback to `PEER_COLORS[0]`
    on overflow.** `models/CollaborationTypes.ts:61-70`,
    `sessionManagement.ts:241`. With 9+ peers, the 9th gets the host's
    blue. UI doesn't handle this — peers with the same colour are
    indistinguishable. Either cap the session at 8 peers (with a
    user-facing error) or generate unique colours via HSL hash of
    `peerId`.

54. **`CollaborationStatusRow.tsx` and the panel use Tailwind colour
    tokens like `text-[var(--color-state-success)]`.** OK, but a
    screen-reader user gets no announcement of state transitions.
    `connectionStatus` changes between `disconnected | connecting |
    connected | error` with no `aria-live` region.
    `CollaborationPanel.tsx:142-167`. `usePresence` updates also have
    no AT announcement — a peer joining is invisible to AT users.

55. **`CollaborationPanel.tsx` has no keyboard shortcut to close the
    panel.** Only the close button (X icon). Press Escape does
    nothing. (`CollaborationPanel.tsx:177-180`.)

56. **`InviteCodeRow.tsx` truncates the displayed code to 40 chars
    with `…` but the `<code>` has no aria attribute exposing the full
    string.** `InviteCodeRow.tsx:22-24`. Screen readers will read
    "abcde…" not the actual invite. The Copy button works, but a
    sighted+AT user has no way to verify the invite text matches what
    they expect to share.

57. **`QrInvite` displays the QR canvas with no `role="img"` or
    `aria-label`.** `QrInvite.tsx:87`: `<canvas ref={canvasRef}
    className="rounded" />` — invisible to AT. The
    "Scan to join" title is a heading (`DawEyebrowLabel`), but there's
    no `aria-describedby` linking the canvas to the description, and
    no off-screen text version of the invite for screen-reader users.

58. **`QrInvite.useEffect` does not abort the `QRCode.toCanvas`
    promise if `inviteString` changes mid-render.**
    `QrInvite.tsx:35-50`. If the user clicks "Copy Invite" twice in
    rapid succession with two different invite strings, two
    `QRCode.toCanvas` promises race; the older one's `.catch` may
    fire **after** the newer one's success, setting `tooLong` → true
    incorrectly. Use an `AbortController` or a token compared at
    completion.

59. **`onPresence` listener registry is not cleared between sessions.**
    `cleanupSubsystems` calls `presenceListeners.clear()`
    (`sessionManagement.ts:491`). Listeners registered before
    `createSession` that survive across sessions (e.g. a long-lived
    `usePresence` hook in a panel that doesn't unmount on session
    leave) are dropped on cleanup, but the hook's `onPresence` was
    called inside `useEffect` so the cleanup function will unsubscribe
    on unmount — meaning the `clear()` is redundant when the hook is
    in a healthy state, and **destructive** if a hook subscribes with
    a stale closure across session boundaries. A re-subscribe on
    session start is needed to recover; today the panel must unmount
    and re-mount to refresh the listener.

60. **No store `error` setter is wired to anything.**
    `collaborationStore` has `error: string | null` and
    `connectionStatus: 'error'`, but no path in `sessionManagement.ts`
    or `peerConnection.ts` sets either to a non-null value. Even on
    `joinSession` parsing failure (`createCollaborationError(...)`
    throws), the error is consumed by the caller's `catch
    logger.warn`. The UI shows "Not connected" forever; the user has
    no diagnostic. (`CollaborationPanel.tsx:341-347` renders
    `state.error` but it's always `null`.)

61. **Connection-status state machine is incomplete.** `disconnected →
    connecting → connected → ...`. There is no transition into
    `'error'` anywhere in the codebase
    (`grep -n "connectionStatus: 'error'" /Users/josecosta/dev/webdaw/src/modules/Collaboration` returns nothing in
    setters). The "error" status is dead state. Combined with #60, the
    UX never escapes `connecting` if the WebRTC handshake silently
    fails.

62. **Handler payload normalisation is over-permissive.** AppAction
    `createCollabSession` (`Command/models/AppAction.ts:254`) has
    `payload: { name: string }` (required). `handleCreateCollabSession`
    treats `name` as optional with `?? 'Host'`
    (`handleCreateCollabSession.ts:7`). Same for `joinCollabSession`'s
    `peerName` — required by `AppAction` but defaulted to 'Peer'
    (`handleJoinCollabSession.ts:7`). The schema and the handler
    contradict: either tighten the schema (the handler's defaulting
    is dead) or relax the schema and document. The current state means
    a programmer who passes `name: ''` gets `'Host'` silently — silent
    data correction.

63. **`leaveCollabSession` handler is sync but `leaveSession` use
    case dispatches a `broadcastCrdtSync` that requires the data
    channel to flush before connection close.**
    `sessionManagement.ts:578-582` calls `broadcastCrdtSync` then
    `cleanupSubsystems` immediately. `cleanupSubsystems` →
    `peerManager.closeAll` → `peer.close()` →
    `crdtChannel.close()`. RTCDataChannel.close() with messages still
    buffered drops them — the host's `peer-leave` is unlikely to be
    delivered because the channel closes before the queue drains. The
    receiving peer never gets the leave notice; they wait the full
    15-second `PEER_CLEANUP_DELAY_MS`.

64. **No throttling on `broadcastPresence`.** Callers in
    `useTimelineInteractions.ts` self-throttle to 100 ms. But the API
    itself doesn't enforce — a future caller could fire at 60 Hz.
    `peerManager.broadcastPresence` (`peerConnection.ts:282-288`)
    iterates connected peers and calls `sendPresence` on each, which
    writes to the unreliable channel. With 7 peers and 60 Hz that's
    420 sends per second per local peer, plus 7× receivers' parsing
    cost.

65. **`AssetTransfer.handleChunk` has no chunk-size validation.**
    `assetTransfer.ts:175-191` accepts the manifest's `chunkSize`
    on faith. A malicious manifest with `chunkSize: 1`,
    `chunkCount: Number.MAX_SAFE_INTEGER` causes the receiver to wait
    indefinitely for chunks. No upper bound, no sanity check
    (`chunkSize × chunkCount === size`).

66. **`assembleAsset` re-hashes the entire blob synchronously
    (`crypto.subtle.digest`).** `assetTransfer.ts:220`. For a large
    asset (say a 200 MB recording stem) this re-reads and re-hashes
    on the main thread. No streaming hash, no Worker offload.

67. **`peer-leave` does not validate `peerId === senderPeerId`.**
    `sessionManagement.ts:664-665`: `removePeer(message.peerId)`
    accepts whatever id the message says. With the data-channel
    routing in `handlePeerMessage` we know the **sender** id (`peerId`
    parameter), but the message body's `peerId` is taken at face
    value. **Confirms #5: a peer can eject any other peer.** The
    fix is `if (message.peerId !== peerId) return`.

68. **Architectural: `sessionManagement.ts` deeply imports from
    `Arrangement`, `AudioEngine`, `CrdtDocument`, `Transport`.**
    Imports at `:1-16`:
    - `trackStore` from `#/modules/Arrangement/stores`
    - `audioBufferCache` from `#/modules/AudioEngine/stores`
    - `getAudioContext` from `#/modules/AudioEngine/useCases`
    - `branchStore` from `#/modules/CrdtDocument/stores`
    - 8 functions from `#/modules/CrdtDocument/useCases`
    - `transportStore` from `#/modules/Transport/stores`

    All resolve to `index.ts` barrels — **OK** under AGENTS.md
    cross-module rules. But `sessionManagement.ts` is now a
    cross-module orchestrator pretending to be a "use case", with
    deep coupling to four other modules' state. It is closer in shape
    to a `bootstrap`-style wiring layer than a single use case.

69. **`events/index.ts` is a stub.** `// no public events`
    (`events/index.ts:1`). Collaboration is one of the modules where
    domain events would help (peer joined, peer left, role granted,
    asset received). Today the only cross-module signal is the
    `collaborationStore` snapshot; downstream modules
    (Arrangement, Transport) check `collaborationStore.value?.isEnabled`
    inline (`Arrangement/presentations/hooks/useTimelineInteractions.ts:275`,
    `Transport/useCases/scheduling/scheduleAudioClips.ts:114`). A
    `collaborationSessionStarted` / `collaborationSessionEnded` event
    would let those modules subscribe rather than poll.

70. **`MAIN_BRANCH_ID = 'main'` is duplicated across modules.**
    `sessionManagement.ts:28`, and presumably defined elsewhere in
    `CrdtDocument`. Hard-coded constant is a sync-by-string between
    modules — a typo on either side silently breaks branch sync. The
    correct path is to import from `CrdtDocument`'s public surface.

71. **`pickPeerColor([PEER_COLORS[0]!])` for joiners is racing.**
    `sessionManagement.ts:365`. Joiner picks a non-blue colour
    locally, but until `handlePeerConnected` runs (host side: assigns
    a colour via `pickPeerColor([state.localColor,
    ...state.peers.map(...)])` at `:452`), the host and joiner can
    independently pick the same colour. The **host's assignment**
    overrides via `peer-info`, but the joiner's local colour
    (`localColor`) is never updated to match — so the joiner displays
    one colour locally, while every other peer sees them in a
    different colour.

72. **No unit test for invite compress/decompress round-trip.**
    `compressInvite` / `decompressInvite` are file-private (not
    exported), so cannot be tested directly. The `joinSession ↔
    generateInvite` round-trip is not tested either. A regression
    in `deflate-raw` handling (browser API change, polyfill) silently
    breaks the entire flow.

73. **`SignalingMessage`'s `name` field is unauthenticated.**
    `models/CollaborationTypes.ts:48-49`: `name: string` is whatever
    the joiner declares. No validation, no length cap. A 10 MB name
    crashes the panel rendering. Same for `PresenceData.name`.

74. **Empty `events/index.ts` and missing root `index.ts` make the
    module's public surface implicit.** Combined with #1, a future
    refactor that adds a function to `useCases/` and forgets to
    re-export from `useCases/index.ts` will break consumers
    silently — `getCollaborationHandlers` is the only "important"
    re-export and the rest are loose adornments.

75. **`PermissionManager.epoch` is reset to 0 on `clear()` but the
    grants themselves are gone.** `permissions.ts:135-137`. A
    subsequent `grantRole` starts at epoch 1, so a stale `role.grant`
    message held by a peer's queue from a prior session at epoch 5
    will out-rank the new grant for several rounds. Per-session
    epochs should be combined with a session id.

76. **`PermissionManager.handleMessage` accepts grants for **the local
    peer**.** `permissions.ts:127-129`: if `data.grant.peerId ===
    state.localPeerId`, the local peer's role is updated **in their
    own grants map**. But `hasCapability(localPeerId, ...)` short-circuits
    via `peerId === state?.localPeerId && state?.isHost` — meaning
    the host's permission entry is ignored if they're host, and a
    non-host local peer's permission is queried via the grants map
    where the host's grant lives. **Not tested.**

77. **No spec for `PermissionManager.handleMessage` host-filter
    bypass.** The single behavioural test in `permissions.spec.ts`
    covers the host's own broadcast path. It does **not** test what
    happens when a non-host peer broadcasts a forged `role.grant`,
    which is precisely the security-critical path. (#4)

78. **No structural separation between "session lifecycle" and
    "session message routing".** `sessionManagement.ts` has both —
    `createSession`/`joinSession` (lifecycle) and `handlePeerMessage`
    (routing). With 820 lines, splitting is overdue: a
    `messageRouter` use case + a session-lifecycle use case would
    halve cognitive load and make routing testable in isolation.

79. **`sessionManagement.ts` not following "one function per file".**
    The file exports 9 named functions (`createSession`,
    `generateInvite`, `joinSession`, `acceptAnswer`, `leaveSession`,
    `broadcastPresence`, `onPresence`, `getAssetTransfer`,
    `getPermissionManager`). AGENTS.md "**One Function Per File:** Every
    `useCase` and `repository` file must export exactly ONE function."
    `useCases/index.ts:1-13` aggregates them by re-exporting from this
    one file. This is the largest single-file violation in the module.

---

## Priorities

1. **Permission system is a no-op** (#3). `canEdit` and
   `canControlTransport` are defined but never called by sync /
   handler / projection paths. **Any peer can mutate any document
   regardless of role.** Fix this before everything else.
2. **`peer-leave` and `peer-info` are forgeable** (#5, #4, #67). Any
   peer can disconnect or impersonate any other peer in everyone
   else's local view. Combined with #3 this is the security ceiling.
3. **`__branches__` doc has no host attestation** (#8). Branches can be
   rewritten by anyone with editor rights. The `__permissions__` route
   filters by stored-host; `__branches__` does not.
4. **Asset transfer DoS surface** (#25, #26, #29, #65). Unsolicited
   manifests fill memory; broadcasting requests fan-out to every
   peer; chunk-size is unvalidated.
5. **No reconnect / no error surfacing** (#19, #20, #60, #61). A
   transient ICE failure ends the session and the user sees nothing.
   `connectionStatus: 'error'` is dead state.
6. **`sessionManagement.ts` is 820 lines, exports 9 functions, mixes
   lifecycle and routing** (#2, #78, #79). The single biggest
   architectural violation in the module.
7. **Presence flicker** (#12). Playhead heartbeat overwrites cursor
   state every 250 ms; visible UX bug today.
8. **CRDT sync ping-pong** (#6). Each remote sync triggers a broadcast
   back to the originator. Doubles bandwidth.
9. **`leaveSession` peer-leave message dropped** (#63).
   `closeAll` runs immediately after `broadcastCrdtSync`; the message
   never delivers; receivers wait 15 s.
10. **No tests for `peerConnection.ts`** (#39). The most security-
    sensitive file in the module is uncovered.

---

## Open issues

### 1. Permissions are advertised but never enforced

**Problem:** `PermissionManager.canEdit` / `canControlTransport` /
`hasCapability` are defined, the type system carries them, the test
file exercises them — but **no caller invokes them**. Confirmed via
`grep -rn "canEdit\|canControlTransport\|hasCapability" src` returning
only the definition file and its own spec. The "viewer" role exists in
the type system but a peer with that role can still issue mutations
that other peers will accept via `automergeSync.receiveSync` and
project into local stores.

**Representative files:**

- `src/modules/Collaboration/useCases/permissions.ts:65-104`
- `src/modules/Collaboration/useCases/automergeSync.ts:88-130` (no role check)
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:647-666` (`handlePeerMessage` routes by docId, not by sender role)

**Needed:** Wire `permissionManager.canEdit(peerId)` into the inbound
sync path. Reject (with logger.warn) `crdt-sync` messages from peers
without `edit` capability for project docs and `__branches__`.
Decide and document whether `__permissions__` and `__asset__` channels
are open to all roles.

### 2. `peer-leave` and `peer-info` are forgeable

**Problem:** `handlePeerMessage` accepts any `peer-info` and adds
the supplied peer (with `isHost: true` if forged) to the local peer
list, and accepts any `peer-leave` and ejects the named peer. The
sender's identity (the `peerId` parameter) is never compared against
`message.peer.id` / `message.peerId`.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:662-666`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:715-743`

**Needed:** Reject `peer-info` where `message.peer.id !== peerId`.
Reject `peer-leave` where `message.peerId !== peerId` (a peer can
only announce their own departure). Reject `peer-info` with
`isHost: true` from non-host senders (verified against
`collaborationStore.value.peers` lookup).

### 3. `__branches__` projection has no host filter

**Problem:** Unlike `__permissions__` (which checks the sender is the
stored host), `__branches__` accepts incoming sync messages from any
peer. A malicious peer can broadcast a `crdt-sync` for `__branches__`
with arbitrary content, and every receiver projects it into their
local `branchStore` (after the JSON-equality cache).

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:162-195`
- `src/modules/Collaboration/useCases/automergeSync.ts:99-104` (auto-creates the doc on first remote message)

**Needed:** Filter incoming `__branches__` sync messages by sender ===
host (same pattern as `permissions.handleMessage`). Or fold the branch
metadata authority into the host-attested `__permissions__` channel.

### 4. Asset transfer is a DoS vector

**Problem:** Multiple sub-issues compound:

- `handleManifest` creates a transfer slot for any incoming manifest, no per-peer cap, no requested-only check (`assetTransfer.ts:163-173`).
- `handleAssetRequest` serves any request, no role check, no rate limit (`assetTransfer.ts:110-161`).
- `requestAsset` broadcasts to all peers; each peer that has the asset sends the full asset back — O(N) bandwidth waste (`assetTransfer.ts:75-87`).
- `handleChunk` has no chunk-size sanity check; manifest can claim `chunkCount: MAX_SAFE_INTEGER` (`assetTransfer.ts:175-191`).
- `missingChunks` is advertised but always empty; no resume support (`assetTransfer.ts:75-87`).

**Representative files:**

- `src/modules/Collaboration/useCases/assetTransfer.ts:75-87, 110-191, 219-225`

**Needed:** Track outstanding requests in a `requestedAssets:
Set<hash>` and reject manifests for assets we didn't request. Add a
per-peer in-flight cap (e.g. 4 transfers) and a manifest-size cap
(reject `size > MAX_ASSET_BYTES`). For requests, prefer
"first responder wins" — receiver sends `asset.request` to one peer
at a time and falls back. Implement bitmap-based resume.

### 5. No reconnect logic; ICE failure terminates the session

**Problem:** `peer.connectionState === 'failed' | 'disconnected'`
fires `onDisconnected` and the cleanup timer (15 s) ejects the peer.
There is no `pc.restartIce()`, no exponential-backoff retry, no UI
indication that a reconnect is being attempted. Combined with the
manual-signaling flow (no signaling server), the user must
manually generate a fresh invite.

**Representative files:**

- `src/modules/Collaboration/repositories/peerConnection.ts:61-68`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:695-713`

**Needed:** On `connectionState === 'failed'`, attempt
`pc.restartIce()` once. If the peer was on a stable connection (not
in initial handshake), surface a reconnecting status. Document the
session lifetime guarantee (probably "until the host's tab closes").

### 6. `connectionStatus: 'error'` is dead state; `error: string | null` is never set

**Problem:** No code path in `sessionManagement.ts` or
`peerConnection.ts` ever transitions `collaborationStore` into
`connectionStatus: 'error'` or sets `error` to a non-null string.
`CollaborationPanel` renders these states but they're unreachable.
ICE timeouts, malformed answers, peer connection failures, and CRDT
persistence failures all silently log and continue.

**Representative files:**

- `src/modules/Collaboration/stores/collaborationStore.ts` (state shape)
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts` (no error setter)
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx:341-347` (renders unreachable error)

**Needed:** Identify the failure surfaces (ICE timeout, malformed
answer, persistence failure, channel error) and route each to
`collaborationStore.set({ ..., connectionStatus: 'error', error: '<message>' })`.
Add an explicit "clear error" action.

### 7. `sessionManagement.ts` is 820 lines and exports 9 functions

**Problem:** AGENTS.md "**One Function Per File:** Every `useCase`
and `repository` file must export exactly ONE function." This file
exports 9 named functions (`createSession`, `generateInvite`,
`joinSession`, `acceptAnswer`, `leaveSession`, `broadcastPresence`,
`onPresence`, `getAssetTransfer`, `getPermissionManager`) plus the
shared `sessionState` holder, plus message routing
(`handlePeerMessage`), plus invite (de)compression, plus branch sync
(start/stop), plus playhead broadcast, plus peer-list mutation
helpers.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts` (820 lines)

**Needed:** Split into:

- `useCases/createSession.ts`, `joinSession.ts`, `acceptAnswer.ts`, `leaveSession.ts`, `generateInvite.ts`, `broadcastPresence.ts`, `onPresence.ts`, `getAssetTransfer.ts`, `getPermissionManager.ts` — one function each.
- `useCases/sessionRouter.ts` (or `services/peerMessageRouter.ts`) for `handlePeerMessage` and helpers.
- `useCases/branchSync.ts` for `startBranchSync` / `stopBranchSync`.
- `useCases/inviteCodec.ts` (or `services/inviteCodec.ts`) for `compressInvite` / `decompressInvite`.
- A persistent `sessionState` holder lives in `stores/sessionStore.ts`
  with a typed shape, replacing the module-level `const`.

### 8. Presence playhead-heartbeat wipes cursor state on receivers

**Problem:** The host's 4 Hz playhead broadcast sends a full
`PresenceData` with `cursorBeat: null`, `cursorTrackId: null`,
`selectedClipIds: []`, `viewportStartBeat: 0`, etc. Receivers merge
with their cached entry via `existing ? { ...existing, ...data } : data`
— so the heartbeat **wipes** the cached cursor every 250 ms. The
receiver's UI sees the cursor disappear except during the brief
window where the sender's mouse moves at 10 Hz.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:546-563` (sender)
- `src/modules/Collaboration/presentations/hooks/usePresence.ts:31` (receiver merge)

**Needed:** Either send only the playhead delta in
`startPlayheadBroadcast` (a separate message type, e.g.
`type: 'presence.playhead'`, with just `peerId` + `playheadBeat`),
or have the receiver-side merge ignore null/empty fields, or stop
broadcasting the cursor fields in the heartbeat (omit them in the
sender, leveraging the discriminated union).

### 9. CRDT sync ping-pong on receive

**Problem:** `automergeSync.receiveSync` calls `replaceCrdtDoc(...)`
which calls `automergeRepository.notifyListeners(id)` which re-enters
our own listener via `subscribeToCrdtChanges` →
`sendDocSyncToAllPeers(docId)`. The sync state for the peer we just
received from is now updated, so generating a sync message **back to
them** is benign (Automerge will produce an empty/no-op message), but
**the broadcast to all other peers** for a doc that hasn't changed
locally is wasted work. There is no "currently applying remote" flag.

**Representative files:**

- `src/modules/Collaboration/useCases/automergeSync.ts:54-66, 88-130`
- `src/modules/CrdtDocument/repositories/automergeRepository.ts:187-190`

**Needed:** Add an `isApplyingRemote` flag in `AutomergeSync` set
during `receiveSync` → `replaceCrdtDoc`; the listener early-returns
if the flag is set. Or pass an "origin" through `replaceCrdtDoc` so
listeners can suppress echo for the originator.

### 10. `leaveSession` drops the `peer-leave` notification

**Problem:** `leaveSession` calls `peerManager.broadcastCrdtSync({
type: 'peer-leave', ... })` then `cleanupSubsystems()` which
immediately closes all data channels. The data channel close drops
queued messages — so the peer-leave is unlikely to be delivered.
Receivers then wait the full 15-second `PEER_CLEANUP_DELAY_MS`.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:577-585`
- `src/modules/Collaboration/repositories/peerConnection.ts:158-163` (close)

**Needed:** Either await `bufferedAmount === 0` on every peer's
crdt channel before closing, or use a synchronous "graceful close"
with a small delay (50 ms) to let the kernel flush. Alternatively,
shorten `PEER_CLEANUP_DELAY_MS` to ~3 s for the case where
peer-leave is dropped.

### 11. Module has no root `index.ts`

**Problem:** `src/modules/Collaboration/` does not have an
`index.ts`. AGENTS.md describes the root `index.ts` as "the sole
cross-module public surface". Cross-module consumers reach in via
three sub-barrels (`/useCases`, `/stores`, `/presentations/views`).
There is no single import path that represents the module's
contract; future contract additions are scattered.

**Representative files:**

- `src/modules/Collaboration/` (missing `index.ts`)
- `src/app/bootstrap.ts:35` (uses `#/modules/Collaboration/useCases`)
- `src/modules/Arrangement/presentations/hooks/useTimelineFileDrop.ts:4`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:11-12`

**Needed:** Add `src/modules/Collaboration/index.ts` re-exporting
runtime values from `./useCases`, `./stores`, `./events`, and
`./presentations/views`. Migrate existing consumers to the root path.

### 12. Tests use `as unknown as` / `as never` to fake fixtures

**Problem:** Multiple specs cast partial mocks to bypass type
checks. AGENTS.md "**TypeScript — soundness**" forbids these escape
hatches.

**Representative files:**

- `src/modules/Collaboration/useCases/__tests__/automergeSync.spec.ts:29` (`peerManager as never`)
- `src/modules/Collaboration/useCases/__tests__/assetTransfer.spec.ts:12, 52`
- `src/modules/Collaboration/useCases/__tests__/permissions.spec.ts:27`
- `src/modules/Collaboration/useCases/collaboration/__tests__/sessionManagement.spec.ts:122`

**Needed:** Build a typed mock factory for `PeerConnectionManager`
that satisfies the real interface (or extract the parts of the
manager interface the consumer needs into a smaller `Sender` type
that is trivially mockable). Same for `collaborationStore.value`.

### 13. `peerConnection.ts` has no tests

**Problem:** The most security-sensitive file in the module — SDP
parsing via `JSON.parse(... as RTCSessionDescriptionInit)`, channel
state machine, ICE gathering timeout, backpressure on
`sendCrdtSyncBuffered` — is uncovered. Malformed-SDP rejections in
`acceptOffer`/`acceptAnswer` propagate as raw `SyntaxError` to the
UI, which logs and shows nothing.

**Representative files:**

- `src/modules/Collaboration/repositories/peerConnection.ts` (no `__tests__/`)

**Needed:** Add tests using `wrtc` or a `RTCPeerConnection` mock
(e.g. happy-dom + `vi.stubGlobal('RTCPeerConnection', ...)`):
- accepts a valid offer / answer round-trip
- rejects malformed SDP with a typed error
- ICE gathering timeout returns partial SDP and **flags it** to the caller
- `sendCrdtSyncBuffered` waits when buffer > HIGH_WATER_MARK and resolves on `bufferedamountlow`
- close() drops queued messages (document the contract)

### 14. `CollaborationPanel` tests are no-ops

**Problem:** Four tests render the same component with identical
mocks and assert `document.body` is truthy. No interaction tests, no
host-vs-joiner branching, no error-state coverage.

**Representative files:**

- `src/modules/Collaboration/presentations/views/__tests__/CollaborationPanel.spec.tsx:15-34`

**Needed:** Replace with a test that:
- mocks `useCollaborationState` to return `isEnabled: false` and asserts the "Start session" / "Join session" blocks render
- mocks to `isEnabled: true, isHost: true` and asserts the "Invite" block + "Leave Session" button
- mocks to `isEnabled: true, isHost: false` (joined) and asserts no "Invite" block
- clicks "Start Session" with a typed name and asserts `createSession` was called
- handles the `error` field rendering

### 15. `usePresence` ref-counter pattern is brittle

**Problem:** `dataRef.current` is a mutable object, `version` is a
counter, the returned array is `Object.values(dataRef.current)` —
which the React Compiler may struggle to memoize across versions
because the underlying object identity is stable but its values
change. The `void version;` line is a tell. On hook unmount the
data is cleared but the version counter is not reset; on re-mount
the first version bump may equal the prior unmount version.

**Representative files:**

- `src/modules/Collaboration/presentations/hooks/usePresence.ts:21-66`

**Needed:** Convert to either (a) `useState<Map<peerId, PresenceData>>(new Map())`
with `setPresences(prev => new Map(prev).set(peerId, data))` — relying
on the React Compiler to skip re-renders when the map ref doesn't
change, or (b) a Zustand-style store outside React with `useStore`
subscribing. The current pattern requires a code comment to explain
why the eslint-disable is "intentional".

### 16. `handleAcceptAnswer` and friends do not propagate errors to the
store

**Problem:** Every `try/catch` in `CollaborationPanel` (and downstream
in `sessionManagement`) catches and `logger.warn`s. The user sees
nothing. The `state.error` field is never set. The session can be
in an unrecoverable error state (e.g. a previous `acceptAnswer`
parse failure left `pendingInviteId` stale) with no surfaced
diagnostic.

**Representative files:**

- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx:76-115`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:344-357, 427-444` (use case throws)

**Needed:** Catch in the use case (or the handler) and
`collaborationStore.set({ ..., error: <message>, connectionStatus:
'error' })`. The panel renders this via the existing error block at
`:341-347`. Add a "Dismiss error" button.

### 17. `usePresence` flicker — duplicate of #8 from a different angle

(Subset of #8; kept separate so it can be addressed by changing only
the receiver-side merge if the sender-side fix is risky.)

**Problem:** Receiver merges `existing` with incoming using shallow
spread; the heartbeat overwrites cursor fields with nulls. Even if
the sender-side fix lands, a defensive receiver should not let
fields collapse to `null` over time.

**Representative files:**

- `src/modules/Collaboration/presentations/hooks/usePresence.ts:31`

**Needed:** Receiver merges with field-skip-if-null for cursor /
selection / viewport fields. Better: split the message into
`presence.cursor` and `presence.playhead` discriminated variants
(applies #8 too).

### 18. ICE timeout silently produces a degraded invite

**Problem:** `waitForIceGathering` resolves on a 10 s timeout if
gathering hasn't completed. The host generates an invite with whatever
candidates were gathered. There is no surfaced "ICE incomplete"
warning, no STUN-failure error, no fallback to TURN
(no TURN server is configured by default).

**Representative files:**

- `src/modules/Collaboration/repositories/peerConnection.ts:170-192`

**Needed:** Track which ICE candidates were gathered. If only
`host` candidates (no `srflx` / `relay`), warn the user that the
invite likely won't work across NAT. Document the manual-signaling
limitation.

### 19. Cross-module duplicate `useCollaborationState` hook

**Problem:** `Collaboration/presentations/hooks/useCollaborationState.ts`
and `Workspace/presentations/hooks/useCollaborationState.ts` are
identical-shape hooks subscribing to the same store with locally
defined defaults. AGENTS.md "Model isolation" justifies the
**type** duplication, but the **hook** is duplicated too.

**Representative files:**

- `src/modules/Collaboration/presentations/hooks/useCollaborationState.ts`
- `src/modules/Workspace/presentations/hooks/useCollaborationState.ts`

**Needed:** Decide whose hook is canonical. If Collaboration is the
canonical one, expose it via the (future) root `index.ts` and have
Workspace consume it. If Workspace's local re-typed view is
intentional (as the AGENTS.md model-isolation rule suggests), rename
one to disambiguate — e.g. `useWorkspaceCollaborationView`.

### 20. `PEER_COLORS` overflow

**Problem:** `PEER_COLORS` has 8 entries; `pickPeerColor` falls back
to `PEER_COLORS[0]` (host blue) when all are used. With 9+ peers,
two peers share blue; the UI cannot distinguish them.

**Representative files:**

- `src/modules/Collaboration/models/CollaborationTypes.ts:61-70`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:239-242`

**Needed:** Either (a) cap session size at 8 with a user-facing
error, or (b) generate unique colours via HSL hash of `peerId`
once the palette is exhausted.

### 21. No accessibility for connection / presence state

**Problem:** Connection status (`disconnected | connecting |
connected | error`) changes silently. Peer joins / leaves are
silent. The QR canvas has no aria attributes. The truncated invite
code is not exposed to AT in full.

**Representative files:**

- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx:142-167`
- `src/modules/Collaboration/presentations/views/QrInvite.tsx:87`
- `src/modules/Collaboration/presentations/components/InviteCodeRow.tsx:22-24`

**Needed:** Wrap the status row in `role="status"` /
`aria-live="polite"`. Add `role="img"` and a descriptive
`aria-label` to the QR canvas. Expose the full invite via
`aria-label` on the `<code>` (or use a hidden `<span class="sr-only">`).

### 22. `compressInvite` allocates O(n) intermediate strings

**Problem:** `Array.from(result, b => String.fromCharCode(b)).join('')`
allocates one string per byte for a multi-KB SDP. The codebase
already has `bytesToBase64` from `#/utils/base64` (used by
`assetTransfer.ts` and `automergeSync.ts`).

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:803`

**Needed:** Use `bytesToBase64(result)` directly. Same for
`decompressInvite` reading direction.

### 23. `AppAction` payload shapes contradict handler defaults

**Problem:** `createCollabSession.payload.name: string` (required)
vs `handleCreateCollabSession` defaulting `name ?? 'Host'`. Same for
`joinCollabSession.peerName ?? 'Peer'`. Either the schema is wrong
or the default is dead.

**Representative files:**

- `src/modules/Command/models/AppAction.ts:254-256`
- `src/modules/Command/useCases/commandQueries.ts:251-253`
- `src/modules/Collaboration/handlers/collaboration/handleCreateCollabSession.ts:7`
- `src/modules/Collaboration/handlers/collaboration/handleJoinCollabSession.ts:7`

**Needed:** Pick one. If empty `name` should default to "Host", make
the AppAction payload `name?: string` and document the default. If
not, drop the `?? 'Host'` and let the type system enforce a
non-empty string at the call site.

### 24. `branchStoreSnapshot` is shallow-cloned

**Problem:** `branchStoreSnapshot = { ...branchStore.value, branches:
[...branchStore.value.branches] }`. The branch records inside the
array are not deep-cloned. If a branch record's `createdFromHeads`
array mutates during the session (which it shouldn't, but
defensively), the snapshot mutates too. The persistence after
`stopBranchSync` is async and may capture the in-session state
rather than the pre-session snapshot.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:127-129, 217-220`

**Needed:** Deep-clone the snapshot (e.g. `structuredClone` or a
typed deep-clone). Await persistence before returning from
`leaveSession` (or expose a "session ended" promise that callers
can await before the tab closes).

### 25. No spec for `permissions.handleMessage` host-filter and epoch
reorder

**Problem:** The single behavioural test in `permissions.spec.ts`
covers only the host's own broadcast path. The receive path —
which is the security-critical surface — has no coverage.

**Representative files:**

- `src/modules/Collaboration/useCases/__tests__/permissions.spec.ts`

**Needed:** Add tests that:
- a `role.grant` from a peer not marked `isHost` is rejected
- a `role.grant` with epoch lower than existing is rejected
- a `role.grant` with epoch higher than existing replaces it
- a `role.grant` for the local peer updates the local table

### 26. No test for invite-codec round-trip

**Problem:** `compressInvite` / `decompressInvite` are file-private
and the `joinSession ↔ generateInvite` round-trip is not tested. A
regression in `deflate-raw` (browser API change, polyfill) silently
breaks the entire flow.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:796-820`
- `src/modules/Collaboration/useCases/collaboration/__tests__/sessionManagement.spec.ts` (no codec test)

**Needed:** Extract the codec into a separate file (per #7 split) and
test compress→decompress identity, legacy uncompressed pass-through,
and rejection of malformed `z:` payloads.

### 27. `MAIN_BRANCH_ID = 'main'` duplicated across modules

**Problem:** `sessionManagement.ts:28` declares
`const MAIN_BRANCH_ID = 'main'` to compare against incoming
branches. The same constant must exist in `CrdtDocument`. Hard-coded
strings sync by typo.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:28`

**Needed:** Import the constant from `CrdtDocument`'s public
surface (or define it once in `models/` of whichever module owns
branch identity).

### 28. `peerConnection` no-error-surfacing on JSON.parse

**Problem:** `acceptOffer` and `acceptAnswer` cast `JSON.parse(...)
as RTCSessionDescriptionInit` with no validation. Malformed SDP
strings throw raw `SyntaxError`s that the use case re-throws and
the panel logs without surfacing.

**Representative files:**

- `src/modules/Collaboration/repositories/peerConnection.ts:96, 106`

**Needed:** Wrap with a typed parser: validate `sdp` and `type`
fields exist and types match, then narrow. Throw a typed
`createCollaborationError` that the use case can route to the store.

### 29. Async `assetTransfer.handleAssetRequest` errors lost via `void`

**Problem:** `handlePeerMessage` calls `void
sessionState.assetTransfer?.handleMessage(...)`. `handleMessage`
catches its own try/catch but `handleAssetRequest`'s
`await sendCrdtSyncBuffered` rejection bubbles up to the caller —
which is the `void` site. **Actually**, `handleMessage`'s try/catch
covers `handleAssetRequest` because it's awaited inside —
let me re-verify: yes, `await this.handleAssetRequest(...)` is
inside the try. **OK** — but the message that triggered the failed
send is silently dropped. The requester waits forever.

**Representative files:**

- `src/modules/Collaboration/useCases/assetTransfer.ts:90-108, 110-161`

**Needed:** On send failure, mark the asset transfer as failed and
notify the caller via a new `onError(hash, error)` callback.

### 30. `branchStore.subscribe` callback re-entrancy guard is per-flag,
not per-call

**Problem:** `isProjectingBranches` is a single boolean. If two
`branchStore` mutations interleave (synchronous JS, but possible if
a microtask flushes), the second one sees `isProjectingBranches`
already true (from the first's projection) and skips the mirror.
The mirror loses the second mutation. Only an issue if the
projection step itself yields a microtask — `mutateCrdtDoc` is
synchronous in the current implementation, so this is academic
today.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:78, 144-159, 184-194, 215-220`

**Needed:** Convert to a per-call counter or pass an "origin" flag
through the projection. Or document that `mutateCrdtDoc` and
`branchStore.set` are guaranteed synchronous and add a runtime
assertion.

### 31. `connectionStatus` transitions don't reach `'error'`

**Problem:** No setter writes `'error'` anywhere
(`grep "connectionStatus: 'error'" src/modules/Collaboration` returns
nothing). The state machine has a dead state.

**Representative files:**

- `src/modules/Collaboration/stores/collaborationStore.ts`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts` (no error setter)

**Needed:** As part of #6, route ICE failures, persistence failures,
and answer-parse failures into `connectionStatus: 'error'`.

### 32. `AutomergeSync.start()` is not idempotent

**Problem:** No double-call guard. The second `start()` overwrites
`unsubscribeFromChanges` without unsubscribing the first; two
subscriptions fire on every change.

**Representative files:**

- `src/modules/Collaboration/useCases/automergeSync.ts:53-66`

**Needed:** `if (this.unsubscribeFromChanges) return;` at the top
of `start()`. Or `this.stop()` first.

### 33. `events/index.ts` empty stub; no domain events

**Problem:** Collaboration emits no events. Cross-module consumers
poll `collaborationStore.value?.isEnabled` inline. Adding session-
lifecycle events would let downstream modules subscribe instead of
poll.

**Representative files:**

- `src/modules/Collaboration/events/index.ts:1` (`// no public events`)
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:275`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:114`

**Needed:** Define `collaborationSessionStarted`,
`collaborationSessionEnded`, `peerJoined`, `peerLeft`,
`assetReceived` events. Migrate consumers off store-polling where
event-driven is more accurate.

### 34. `localColor` racing between joiner and host assignment

**Problem:** Joiner picks a colour locally, but host assigns a
(possibly different) colour via `peer-info`. The joiner's local
`collaborationStore.localColor` is never updated to match the
host's assignment. Locally the joiner sees themselves in colour A;
every other peer sees them in colour B.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:362-365, 446-462`

**Needed:** When the host's `peer-info` arrives for the joiner's
own peerId, update `collaborationStore.localColor` to match.

### 35. `PEER_COLORS` overflow + no spec coverage on join with full
session

**Problem:** Issue #20 plus no spec exercising the 9+ peer scenario.

**Representative files:**

- `src/modules/Collaboration/useCases/collaboration/__tests__/sessionManagement.spec.ts`

**Needed:** Add a test that exercises `pickPeerColor` with 8 used
colours and verifies the documented behaviour (whatever that ends
up being — error or colour reuse).

### 36. `PresenceData.name` and `SignalingMessage.name` are unbounded

**Problem:** Both fields accept arbitrary-length strings. A 10 MB
peer name crashes the panel.

**Representative files:**

- `src/modules/Collaboration/models/CollaborationTypes.ts:48-49, 27-29`

**Needed:** Validate length at the message-receive site (e.g. cap at
64 chars). Reject messages with names exceeding the cap.

---

## Open questions

- [ ] What is the authentication model? Today there is none — peers
      establish a connection via SDP exchange and trust each other
      transitively. Is that the intended model or is auth a future
      addition?
- [ ] Is the `__permissions__` channel meant to be the canonical
      authority for branch metadata too, or is `__branches__` an
      explicit "trusted-by-being-CRDT" surface?
- [ ] Should `leaveSession` be awaitable (returning a Promise that
      resolves after `peer-leave` flush + persistence)? Today it
      returns `void`.
- [ ] What's the intended answer to "host laptop closes" today?
      `pc.connectionState === 'failed'` after a delay; the joiners are
      stranded with no graceful path to recover state. Does the spec
      assume a signaling server will land, or a fully P2P recovery?
- [ ] Are `AppAction` payloads `name: string` (required) and the
      handler defaulting `?? 'Host'` (silent default) intentional? If
      yes, document.
- [ ] Should the `useCollaborationState` hook live in Collaboration,
      Workspace, or both (with the latter being a re-typed view)?

---

## Risks

- **Security: any peer can mutate any document.** Issue #1: roles
  are theatre. A malicious editor (or a confused peer with a stale
  client) sends `crdt-sync` messages and every receiver projects
  them into local stores. **This is the headline risk.**
- **Security: any peer can disconnect / impersonate any peer.** Issue
  #2: `peer-leave` and `peer-info` are unauthenticated. A hostile
  joiner can fragment the mesh from each receiver's perspective, or
  appoint themselves host.
- **Security: branch metadata can be rewritten by anyone.** Issue
  #3: `__branches__` has no host filter, unlike `__permissions__`.
- **DoS / memory exhaustion via asset manifests.** Issue #4: incoming
  manifests are accepted unconditionally; an attacker fills the
  receiver's memory with `Map<number, Uint8Array>` slots.
- **Data loss on transient network failures.** Issue #5: no reconnect
  logic. A 30-second Wi-Fi blip ends the session and forces a manual
  re-invite, with any in-flight CRDT changes potentially un-synced
  (depends on the persistence cadence).
- **Silent failure UX.** Issues #6, #16, #18: every error path logs
  and continues. The user sees "Connecting..." forever. The
  `collaborationStore.error` field is unreachable.
- **Architectural drift.** Issues #7, #11, #19, #27: 820-line
  use-case files, missing root barrel, duplicated hooks. Each future
  feature lands as a patch on `sessionManagement.ts`, growing the
  cognitive load further.
- **DSP-style cosmetic bugs become user-visible.** Issue #8: cursor
  flicker every 250 ms is not a sync bug, but it's the kind of UX
  detail users see immediately and trust eroding.
- **Test theatre.** Issues #13, #14, #25, #26: tests pass but cover
  no behaviour. The most security-sensitive file
  (`peerConnection.ts`) is uncovered. The most complex behaviour
  (`automergeSync.receiveSync`) is uncovered. A future regression
  ships green.

---

## Suggested approaches

- **Land the security fixes first, in this order**: (a) wire
  `permissions.canEdit` into `automergeSync.receiveSync` to filter
  inbound; (b) authenticate `peer-info` / `peer-leave`; (c) add
  host-filter to `__branches__`. Each is small in code; combined
  they close the headline risks. Pair each with a behavioural test.
- **Surface errors before refactoring.** Issue #6 / #16 / #31 are
  small (route exceptions to the store) and unblock everything else
  by giving a real error UX during refactors.
- **Asset transfer hardening as a focused pass.** Issues #4 and
  related — track requested assets, cap manifest sizes, implement
  resume bitmap, prefer "first responder wins" for fan-in. Test
  with two peers exchanging a 5 MB blob.
- **Split `sessionManagement.ts`.** Issue #7. One function per file,
  with router and codec as services. A holder-store moves to
  `stores/sessionStore.ts`. This is mechanical but unblocks
  smaller PRs going forward and removes the largest AGENTS.md
  violation.
- **Reconnect & error UX as a single spec.** Issues #5, #6, #18, #31.
  ICE-restart on `failed`, surface "reconnecting..." status, expose
  ICE-degraded warnings. Coordinate with whatever team owns
  notification UX.
- **Add the root `index.ts`.** Issue #11. Mechanical. Unblocks
  tighter contract boundaries for the next module audit.
- **Replace the `as never` test casts** with typed mock factories.
  Issue #12 across four files.
- **Test the codec round-trip + `peerConnection` SDP parsing.**
  Issues #13, #26.

---

## Recommendation

Start with **issue #1 (permission enforcement)**. Without it, every
other security-flavoured fix in this audit is gated behind "this is
trust-based collaboration anyway, so why bother". With permissions
actually enforced at the inbound-sync boundary, the rest of the
security issues (#2, #3) can be reasoned about in isolation, and
asset-transfer hardening (#4) gets a meaningful "viewer cannot
request" rule.

After permissions land, address **issue #6 (error surfacing)**
because every subsequent change benefits from the user being able
to see what went wrong, including during the bug-hunt phase of
this audit's other findings. Then **issue #2 (peer-leave / peer-info
auth)** as the minimal second-tier security fix. Then split
`sessionManagement.ts` (#7) — a structural refactor that is easier
once the above three have made the file smaller in scope.

The DSP-cosmetic items (#8 presence flicker) are user-visible and
trivial to fix; tackle as a small drive-by once the security
fixes are queued.

---

## Resolved

_No issues resolved yet._
