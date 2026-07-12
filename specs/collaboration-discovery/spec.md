---
type: spec
id: SPEC-collaboration-discovery
title: Collaboration discovery and media channels
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Collaboration discovery and media channels

## Intent

Expand peer connectivity beyond manual/QR invite and mDNS with optional desktop discovery
modes — libp2p DHT/Rendezvous keyed by the session secret, and VPN-direct (Tailscale /
ZeroTier / WireGuard) that skips WebRTC signalling — plus separate Opus media channels for
voice chat and remote monitoring. mDNS + manual invite stay the defaults.

## Non-goals

- Asset transfer and library policies (see `collaboration-asset-transfer`).
- Transport sync and clock (see `collaboration-transport-sync`).
- Roles and trust tokens (see `collaboration-roles-trust`).

## Requirements

### AC-001 — DHT pairing across LANs

With DHT enabled and a valid bootstrap list, two peers on disjoint LANs must discover and pair
without manual invite within ≤10 s on a typical home network.

Verify with: `manual` — enable DHT on two disjoint LANs; confirm pairing within 10 s

### AC-002 — VPN-direct skips STUN/TURN

With both peers reachable over a Tailscale `100.64.0.0/10` address, CRDT and asset
channels must negotiate directly with no traffic to the STUN server (packet capture).

Verify with: `manual` — connect two Tailscale peers; capture packets and confirm no STUN traffic

### AC-003 — Advanced profiles validated, fail-safe

Custom STUN/TURN/rendezvous values must be validated at save; malformed entries surface a
structured error and never brick the Collaboration module.

Verify with: `pnpm test:run -- discoveryProfileValidation`

### AC-004 — Graceful degradation

A session configured with DHT must load on a machine with DHT disabled, degrading to the other
enabled modes.

Verify with: `pnpm test:run -- discoveryGracefulDegrade`

### AC-005 — Voice and monitoring media channels

Separate Opus-encoded WebRTC media channels must carry voice chat and remote monitoring
independently of the data channels.

Verify with: `manual` — open voice chat and remote monitoring; confirm both stream over Opus media channels

## Open questions

- [ ] (non-blocking) Whether DHT/Rendezvous ships before or after VPN-direct. Default:
  VPN-direct first (simpler), DHT second.

## Affected areas

- `src/modules/Collaboration/` (discovery transports, media channels)
- Settings → Collaboration (bootstrap list, STUN/TURN profiles)

## Dropped from sources

- Automerge document compaction (§3.2) — recorded as a deferred gap against `crdt`.
