---
type: research
id: RESEARCH-collaboration-semantic-crdt
title: Remaining collaboration capabilities over the CRDT core
status: open
owner: The Sourdaw team
sources:
  - Consolidated collaboration research vs current codebase
---

# Research: Remaining collaboration capabilities over the CRDT core

## Question

Given that basic Automerge storage, WebRTC signaling, mDNS discovery, and QR
invites already work, which collaboration capabilities — discovery, media,
transport sync, asset transfer, history compaction, and permissions — are still
missing or only partially implemented?

## Findings

### R-001 — Advanced discovery modes are absent

- **Claim:** Only manual/QR and mDNS discovery exist; DHT/Rendezvous (libp2p
  Kademlia), VPN-direct (Tailscale/ZeroTier/WireGuard), and user-configured
  STUN/TURN/bootstrap profiles are not implemented.
- **Evidence:** Codebase finding — manual/QR and mDNS only in
  `src/modules/Collaboration`.
- **Confidence:** medium
- **Bears on:** discovery scope for the collaboration features.

### R-002 — No media channels for audio collaboration

- **Claim:** Sourdaw needs separate Opus media channels — `voice-chat`,
  `remote-monitor`, and `live-input` — independent of project audio.
- **Evidence:** `peerConnection.ts` sets up only data channels (`crdt-sync`,
  `presence`); no media streams are negotiated.
- **Confidence:** high
- **Bears on:** any voice/monitoring collaboration requirement.

### R-003 — Transport sync uses CRDT scalars, not a leader/clock model

- **Claim:** Real-time transport synced via plain CRDT scalar fields causes
  playback jitter/misalignment under latency; a dedicated peer-to-peer monotonic
  time-sync with a leader model is needed for sample-accurate remote playback.
  The model needs a transport leader (play/stop/seek/loop/record-arm authority), an
  RTT/offset time-sync algorithm, a play-command protocol (target time + tempo
  revision), and a split-brain guard (leader ID, epoch, sequence number).
- **Evidence:** No leader model or clock sync in `src/modules/Collaboration/`;
  transport state rides standard CRDT scalar fields.
- **Confidence:** medium
- **Bears on:** the transport-sync collaboration feature and its sync protocol.

### R-004 — Asset transfer is partial

- **Claim:** Asset transfer exists but full BLAKE3 content-addressed dedup,
  resumption bitmaps, and library-reference mapping (map missing hashes to local
  library roots; bitmap-driven chunk resume) need polish to meet the spec.
- **Evidence:** `src/modules/Collaboration/useCases/assetTransfer.ts` handles
  WebRTC data channels for assets; dedup/resume/reference policies incomplete.
- **Confidence:** medium
- **Bears on:** the asset-transfer feature.

### R-005 — No document compaction strategy

- **Claim:** An Automerge compaction strategy is needed to prune history while
  keeping peers mergeable and not breaking the session's undo history (compacted
  snapshots vs retained recent change history).
- **Evidence:** No compaction evidence in the codebase.
- **Confidence:** medium
- **Bears on:** CRDT history/semantic-history features.

### R-006 — Host approval and fine-grained permissions are partial

- **Claim:** Basic roles exist, but the host-approval join flow and cryptographic
  role-grant enforcement via session-signed tokens may not be fully integrated
  into the UI.
- **Evidence:** `src/modules/Collaboration/useCases/permissions.ts` handles roles
  via a `__permissions__` docId; approval prompt + token enforcement not confirmed
  in the UI.
- **Confidence:** medium
- **Bears on:** the collaboration roles/trust feature.

## Open questions

- [ ] Q-001 — Which discovery modes (R-001) are in scope for desktop vs web
  builds? The libp2p/VPN modes are desktop-first and gate native networking work.
- [ ] Q-002 — What latency budget must transport sync (R-003) hold to be
  "sample-accurate" enough, and does the leader model need failover?
- [ ] Q-003 — How complete is the current asset-transfer dedup/resume (R-004) —
  does it already partially implement BLAKE3/bitmaps, or start from scratch?

## Recommendation

A spec author could lift the leader/clock transport-sync model (R-003) as the
highest-value cross-cutting piece, since CRDT scalars are observed to be
insufficient for real-time playback. Media channels (R-002) and compaction
(R-005) are independent tracks. Discovery (R-001) and permissions (R-006) depend
on platform/scope decisions (Q-001) and should be scoped after those are settled.
