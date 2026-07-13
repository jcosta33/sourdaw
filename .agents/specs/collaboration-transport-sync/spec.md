---
type: spec
id: SPEC-collaboration-transport-sync
title: Collaboration transport sync — leader, clock, split-brain
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Collaboration transport sync — leader, clock, split-brain

## Intent

Add opt-in synchronized transport for jam/rehearsal sessions on top of the existing
peer-to-peer foundation: an explicit single-leader model with epoch-based authority
handoff, NTP-style peer-to-peer monotonic clock sync so followers start sample-accurately,
and split-brain detection after a partition. Normal editing keeps ghost playheads, never
hard-sync.

## Non-goals

- Semantic CRDT collaboration and conflict views (see `collaboration-semantic-crdt`).
- Roles, trust tokens, and approval UX (see `collaboration-roles-trust`).
- Asset transfer and discovery (see `collaboration-asset-transfer`, `collaboration-discovery`).

## Requirements

### AC-001 — Single leader invariant

At most one `TransportLeader` record must have `released_at == null` at any point in the session
document, enforced by a CRDT merge-invariant test; only the leader's transport commands
advance remote transports.

Verify with: `pnpm test:run -- transportLeaderInvariant`

### AC-002 — Fast handoff and independent mode

Leadership handoff must complete ≤500 ms on a LAN; a per-peer "Follow Leader / Independent"
toggle persists in local (non-CRDT) storage across reload.

Verify with: `pnpm test:run -- transportLeaderHandoff`

### AC-003 — Monotonic clock offset converges

After ≤5 s of pings, peer-to-peer offset must be stable within ±200 µs on a loopback transport;
the estimator rejects >5× rolling-median outliers without destabilizing.

Verify with: `pnpm test:run -- transportClockOffset`

### AC-004 — Sample-accurate scheduled start

A leader `play` targeting 200 ms in the future must start all followers within ≤2 ms of the
leader's start; a simulated 50 ms one-way delay is compensated by offset, not "play now".

Verify with: `pnpm test:run -- transportScheduledStart`

### AC-005 — Split-brain guard

Two peers claiming leader at the same epoch must converge on the deterministic winner
(higher `peer_id`) within ≤1 s on rejoin; the loser is marked `desynced` without audio
glitching; stale (`epoch <`) packets drop silently.

Verify with: `pnpm test:run -- transportSplitBrain`

## Open questions

- [ ] (non-blocking) Default record-arm authority — leader-only vs per-peer. Default:
  leader-only in synced mode.

## Affected areas

- `src/modules/Collaboration/` (leader use cases, clock sync, epoch/sequence guard)
- transport UI (follow-leader affordance, desynced indicator)

## Dropped from sources

- None — scopes §3.1 and §9.1–9.3 directly.
