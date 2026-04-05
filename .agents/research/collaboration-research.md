# Sourdaw Collaboration — Consolidated Research & Implementation Status

> **Codebase Annotation:** Basic Automerge storage, WebRTC signaling, mDNS local discovery, and QR invites are **Fully Implemented** (`src/modules/Collaboration`). The remaining features listed below (advanced discovery, media streaming, peer-to-peer transport synchronization, and compactions) are **Missing**.

This document consolidates earlier research from `collab.md` and `collab-iroh.md`, retaining only the unimplemented or partially implemented concepts, annotated with current codebase findings. Sections describing features that are already fully implemented (e.g., `AutomergeStorage`, basic WebRTC signaling, mDNS local discovery, QR/manual invites) have been removed for clarity.

## 1. Unimplemented Discovery Modes & Helpers

**Status:** MISSING
**Codebase Findings:** Only manual/QR and mDNS exist. The advanced profiles mentioned below are not implemented yet.

- **DHT / Rendezvous Discovery (Desktop-First):** For native builds, support optional discovery through libp2p Kademlia and/or Rendezvous. This would use session secrets to lookup topics and publish peer multiaddrs.
- **VPN Direct:** Directly connecting via Tailscale, ZeroTier, or WireGuard bypassing WebRTC entirely.
- **Advanced Networking Profiles:** User-configured STUN servers, self-hosted coturn TURN relays, user-provided rendezvous bootstrap nodes.

## 2. Media Channels (Audio Streaming & Monitoring)

**Status:** MISSING
**Codebase Findings:** `peerConnection.ts` only sets up data channels (`crdt-sync` and `presence`). No media streams (Opus, WebRTC audio tracks) are initialized or negotiated for voice chat, remote monitoring, or live input.

Sourdaw needs separate logical channels for audio collaboration:

- **`voice-chat`**: Opus media stream, independent from project audio, push-to-talk or always-on.
- **`remote-monitor`**: Opus stereo streams for hearing another peer's render/output.
- **`live-input`**: Optional low-latency input monitor stream from one peer to another.

## 3. Transport Synchronization & Leader Model

**Status:** PARTIALLY IMPLEMENTED / DIFFERENT
**Codebase Findings:** No `leader` model or `clock` synchronization is implemented in `src/modules/Collaboration/`. The transport playback state is synchronized via standard CRDT scalar fields, without a dedicated peer-to-peer monotonic time synchronization protocol to compensate for latency. **SUPERIOR METHOD:** Original Research - Using standard CRDT scalar fields for real-time transport synchronization causes unacceptable playback jitter and misalignment between peers due to network latency. A dedicated peer-to-peer monotonic time synchronization protocol with a leader model is necessary to guarantee synchronous, sample-accurate remote playback.

- **Leader Model:** At any moment one peer is the transport leader responsible for play, stop, seek, loop changes, record-arm authority.
- **Time Sync Algorithm:** Do not rely solely on wall-clock/NTP. Use peer-to-peer monotonic time synchronization to compute RTT, one-way delay, and clock offset.
- **Play Command Protocol:** Leader sends target playback time and tempo revision; followers compute offset and schedule local playback for the leader's target future time.
- **Split-Brain Guard:** Transport packets must include leader ID, epoch, and sequence number.

## 4. Advanced Asset Transfer Features

**Status:** PARTIALLY IMPLEMENTED
**Codebase Findings:** `src/modules/Collaboration/useCases/assetTransfer.ts` exists and handles WebRTC data channels for assets, but the full BLAKE3 content-addressed deduplication, resumption bitmaps, and advanced library reference mapping may require polish to match the specs.

- **Library Reference Policies:** Users should be able to map missing asset hashes to local library roots (avoiding transfers of large commercial sample libraries).
- **Chunking & Resume:** Transfers should be bitmap-driven (receiver tracks completed chunks) allowing reconnects to resume missing chunks.

## 5. Document Compaction

**Status:** MISSING
**Codebase Findings:** No evidence of an Automerge document compaction strategy to prune history while maintaining peer mergeability.

- Support compacted snapshots vs retained recent change history.
- Ensure compaction does not break undo history required for the current session.

## 6. Host Approval UX and Fine-Grained Permissions

**Status:** PARTIALLY IMPLEMENTED
**Codebase Findings:** `src/modules/Collaboration/useCases/permissions.ts` handles basic roles via a `__permissions__` docId, but the host approval flow (prompting the host when someone tries to join an approval-required session) and cryptographic role grant enforcement via session-signed tokens may not be fully integrated into the UI.
