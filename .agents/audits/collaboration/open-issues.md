# Collaboration Module — Open Issues

Tracks work done and remaining gaps in the WebRTC collaboration feature.
All issues have been verified against the current codebase.

---

## ✅ Done

### ICE gathering race condition
`createOffer()` and `acceptOffer()` returned SDP before ICE candidates were gathered,
producing candidate-less SDPs that caused data channels to never open.
Fixed with `waitForIceGathering()` (10 s timeout, `icegatheringstatechange` event).

### QR code invite too large
ICE-complete SDPs exceed QR capacity. Fixed with browser-native `CompressionStream`
(deflate-raw, `z:` prefix for backward compat). `QrInvite` shows a fallback copy
button if the compressed string is still too large.

### Peer matching in `acceptAnswer`
Host stored the pending peer by joiner's own UUID but the answer had no way to
correlate it back. Fixed by embedding `pendingPeerId` in both offer and answer.

### Color collisions
`assignPeerColor(index)` used array position, causing duplicate colors when peers
left and rejoined. Replaced with `pickPeerColor(excludeColors)` — first available
color from `PEER_COLORS` not already in use.

### Dead ICE candidate code
`onIceCandidate` callback, `addIceCandidate()`, and `getAllPeerIds()` were unused
after switching to vanilla ICE (gather-then-send). All removed.

### Dead permissions code
`setJoinRequestHandler`, `requestRole`, `getAllGrants`, and `role.request` message
type removed — join approval flow was never implemented.

### Dead transport code
`transferLeadership()`, `tempoRevision` on play, `continuePlayback` on seek —
all removed. `electNewLeader()` is the only leadership change path.

### `AssetRef` type and `asset.complete` message
`AssetRef` was never used. `asset.complete` was never sent or handled. Both removed.

### `approvalRequired` field
`CollaborationState.approvalRequired` was set but never read anywhere. Removed from
type, store, and all `defaultState` objects.

### Robustness — try/catch
Added error boundaries in `assetTransfer.handleMessage`, `transportSync.handleMessage`,
`permissions.handleMessage`, and `automergeSync.receiveSync` (malformed Automerge
sync messages).

### Asset filename
`addLocalAsset` now stores `{ blob, name }` so the manifest sent to peers carries
the real filename instead of `'unknown'`.

### Backpressure for asset chunks
`sendCrdtSyncBuffered()` added to `PeerConnection` and `PeerConnectionManager`.
Asset chunk sending uses it to avoid overflowing the data channel buffer.

### LAN discovery removed
`lanDiscovery.ts` and `NearbyPanel.tsx` deleted — the feature was unimplemented
and had no consumers.

---

## 🔴 Open — Integration gaps

These are fully-built subsystems that exist in the module but are not wired
into the rest of the application.

---

### ~~INT-1 · Ghost playheads~~ — DONE

Added `playheadBeat: number | null` to `PresenceData`. A 4 Hz interval in
`sessionManagement` reads `transportStore.playheadPosition` and broadcasts it
to all connected peers. `PresenceOverlay` renders a dashed peer-colored vertical
line at each peer's playhead position with a name label at the bottom.
`usePresence` now merges incoming updates instead of replacing, so playhead
broadcasts don't wipe cursor position and vice versa.

`TransportSync` (play/stop/seek broadcast + leader election + clock ping/pong)
deleted entirely — play and stop are per-peer local actions, and clock sync
is only needed once CG-1 (latency display) is implemented.

---

### ~~INT-2 · Presence never broadcast~~ — DONE

`broadcastPresence` is called from `handleMouseMove` in `useTimelineInteractions`
throttled to 10 Hz. Sends `cursorBeat` + `cursorTrackId` (via `getTrackAtYHelper`)
for the arrangement view. `PresenceOverlay` cursor lines are now live.

---

### ~~INT-3 · Role grants never issued~~ — DONE

`handlePeerConnected` in `sessionManagement` now calls
`permissionManager.grantRole(peerId, 'editor')` immediately on connect.
Joiners can edit by default.

---

### ~~INT-4 · Asset transfer not wired to clip playback~~ — DONE
**Severity:** P2

`getAssetTransfer()` is exported but nothing calls `requestAsset(hash)` when a clip's
audio file is missing locally. Peers joining a session mid-project will have silent
clips.

This is a multi-step feature, not a one-liner. The `Clip` model (`Track.ts`) has
`audioBufferId` (a local cache key) but no content-addressed hash. The full scope:

1. Add `assetHash?: string` to the `Clip` model (CRDT-backed — persists and syncs)
2. In the audio import flow, call `getAssetTransfer()?.addLocalAsset(blob, name)` and
   store the returned hash as `clip.assetHash`
3. In `scheduleAudioClips`, when `audioBufferCache.get(clip.audioBufferId)` misses
   and `clip.assetHash` is set, call `getAssetTransfer()?.requestAsset(clip.assetHash)`
   (fire-once — guard with a `requestedAssets` set to avoid spamming)
4. In `AssetTransfer.onAssetAvailable`, decode the blob to an `AudioBuffer`,
   store it in `audioBufferCache` under the original `audioBufferId`, and
   trigger re-scheduling

---

## 🟡 Open — Correctness gaps

---

### CG-1 · `latencyMs` never updated
**Severity:** P3 (downgraded — no UI currently shows it)

`PeerInfo.latencyMs` is always `null`. `TransportSync` (which had clock ping/pong)
was deleted. If latency display is added to `CollaborationPanel`, implement a
dedicated lightweight clock ping service and write RTT back to the store.

---

### ~~CG-2 · Stale peers after hard disconnect~~ — DONE

`handlePeerDisconnected` now schedules a 15-second cleanup timer via
`peerCleanupTimers`. If the peer reconnects, `handlePeerConnected` cancels the
timer. If not, `removePeer` fires after the timeout. All timers cleared in
`cleanupSubsystems`.

---

### ~~CG-3 · Single concurrent invite slot~~ — DONE

Added a hint label below the "Copy Invite" / "QR" buttons in `CollaborationPanel`
so hosts know to wait for the current invite to be accepted before generating a new one.

---

## 🔵 Open — Design decisions needed

---

### DD-1 · Branch topology not synced across peers
**Severity:** P1

`branchStore` persists to `localStorage`. Branch documents (the actual content) live
in Automerge and will sync, but the branch list metadata (names, IDs, source IDs)
is local-only. Peer B never sees peer A's branches during a session.

Requires a product call: are branches a per-user workspace concept (keep local)
or a shared session concept (move metadata into a synced Automerge doc)?
