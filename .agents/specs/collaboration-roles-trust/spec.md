---
type: spec
id: SPEC-collaboration-roles-trust
title: Collaboration roles and signed trust tokens
status: superseded
superseded_by: .agents/decisions/0016-ultracode-session-scope-and-standard.md
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Collaboration roles and signed trust tokens

> **Superseded — not the current behaviour.** ADR 0016 ruling 4 deleted the
> collaboration role scaffold this spec would have hardened. Today **an invite
> grants unconditional write access**: there are no roles, no capability checks
> and no host approval step. `PermissionManager`, `PeerRole`, the
> `__permissions__` sync document and the `viewer` / `transport-controller`
> tiers no longer exist in the codebase, so the present-state observations
> below (including the `epoch` note) describe deleted code.
>
> This document is retained as the design record for what a real permission
> model would need — host approval, an append-only audit log, signed and
> revocable tokens — if the project ever decides to restrict a collaborator.
> Nothing here is implemented or scheduled.

## Intent

Make collaboration roles tamper-evident and host-governed: a host approval flow for
promote/demote with an append-only audit log, and Ed25519 session-signed role tokens
(expiry, revocation) verified on every `__permissions__` merge so a peer cannot grant
itself a role by editing its local Automerge copy.

## Non-goals

- Transport leadership/sync (see `collaboration-transport-sync`).
- Semantic conflict views (see `collaboration-semantic-crdt`).
- Asset transfer and peer discovery (see `collaboration-asset-transfer`, `collaboration-discovery`).

## Requirements

### AC-001 — Host approval flow

A promotion/demotion request must show the host a modal (requester identity, requested role,
Accept / Deny / Accept-for-60-min); on Accept the role applies in the requester's UI
within ≤2 s; a denied request never mutates the permissions document.

Verify with: `pnpm test:run -- collaborationRoleApproval`

### AC-002 — Append-only audit log

Every accept/deny/timeout must be recorded in an append-only audit log (no delete path in the
use-case surface) exportable as JSON via `exportSessionAuditLog`.

Verify with: `pnpm test:run -- collaborationAuditLogAppendOnly`

### AC-003 — Timed grant auto-reverts

"Accept for 60 min" must revert the role after 60 minutes of session wall-clock, logging the
reversion.

Verify with: `pnpm test:run -- collaborationTimedGrantRevert`

### AC-004 — Signed tokens, tamper rejected

Locally editing the Automerge doc to upgrade one's own role must be rejected on the next merge;
effective role falls back to the last valid signed token.

Verify with: `pnpm test:run -- collaborationTokenTamperRejected`

### AC-005 — Revocation and expiry

`revokeRoleToken(nonce)` must drop the peer to `observer` within ≤5 s on a LAN; expired tokens
are treated as absent with a one-click renewal prompt; the private key never leaves the
host (no export in the use-case surface).

Verify with: `pnpm test:run -- collaborationTokenRevokeExpire`

### AC-006 — Late-join grant bootstrap

When a peer joins mid-session the host must send that peer a snapshot of all current role
grants (not only that peer's own grant), so a late joiner's `canEdit(otherPeerId)` resolves to
the host's actual decision rather than `false`; today `permissions.ts` clears grants on session
start and only emits per-connection `grantRole` events, so a third joiner has empty grants for
everyone except itself.

Verify with: `pnpm test:run -- collaborationLateJoinGrantBootstrap`

### AC-007 — Epoch scoped to the session

A role grant's epoch must be scoped to a session identifier so a stale `role.grant` held in a
peer's queue from a prior session cannot out-rank a current grant; `clear()` resetting `epoch`
to 0 alone must not let a queued epoch-5 message override a fresh epoch-1 grant.

Verify with: `pnpm test:run -- collaborationGrantEpochSessionScoped`

## Open questions

- [ ] (restored detail) Grant-delivery ordering: the host broadcasts a new `role.grant` via
  `broadcastCrdtSync` (`permissions.ts:58-62`) whose receiver-side resolution depends on the
  recipient's CRDT channel being open at broadcast time, and on `broadcastCrdtSync` iterating the
  `peers` Map in insertion order (`permissions.ts:94`) — neither is contract-guaranteed. Define
  whether grants need an idempotent resend/ack so a missed broadcast is recoverable.
- [ ] (restored detail) Cross-peer grant ordering: `permissions.handleMessage` authorises a
  grant by finding `state.peers.find(p => p.id === peerId && p.isHost)` (`permissions.ts:122`),
  so a `role.grant` that arrives before the host's `peer-info` is silently dropped with no retry.
  Host→joiner order holds on the shared reliable channel today, but a future mesh relay
  (joiner-A → joiner-B) has no ordering guarantee. Decide the bootstrap/retry rule.
- [ ] (restored detail) Star-topology peer-info gap undercuts cross-peer role resolution:
  `acceptAnswer` adds a new joiner to the host's local peer list but never re-broadcasts that
  joiner's peer-info to existing joiners (`sessionManagement.ts:458-461`); `handlePeerConnected`
  sends only the host's own peer-info to the new joiner. In a host + joiner-A + joiner-B star,
  joiner-A never learns joiner-B's id/name/colour even though Automerge sync is host-relayed, so
  `canEdit(joiner-B-id)` on joiner-A resolves against a peer it has never seen — the late-join
  grant bootstrap (AC-006) cannot complete for a peer the resolver does not know exists. Decide
  whether the host must relay each joiner's peer-info to the rest of the star before grant
  resolution can be relied on cross-peer.

- [ ] (non-blocking) Default token expiry (24 h proposed) and signing library (`tweetnacl`
  web / `ed25519-dalek` native).

## Known risks

- (present state) `permissions.handleMessage` resets grants and `epoch` on session start but
  never re-populates from the host; a third joiner arriving mid-session sees empty grants for
  everyone except itself (`permissions.ts:134-137`).
- (present state) `PermissionManager.epoch` resets to 0 on `clear()` while grants are discarded,
  so a fresh `grantRole` starts at epoch 1 and can be out-ranked by a queued epoch-5 grant from a
  prior session (`permissions.ts:135-137`).
- (present state) `permissions.handleMessage` updates the local peer's own role inside its own
  grants map (`permissions.ts:127-129`), but `hasCapability(localPeerId, ...)` short-circuits via
  `peerId === state?.localPeerId && state?.isHost`, so the host's grant entry for a non-host
  local peer is queried from the grants map — untested.
- (present state) The roles test fakes its peer manager with a soundness escape forbidden by
  AGENTS.md ("no `as unknown` / `as never`"): `useCases/__tests__/permissions.spec.ts:27`
  `as unknown as PeerConnectionManager`. The single behavioural test covers only the host's own
  broadcast path, not a non-host peer broadcasting a forged `role.grant` — the security-critical
  case.

## Affected areas

- `src/modules/Collaboration/useCases/permissions.ts`, session document schema
- host approval modal, audit-log export

## Dropped from sources

- None — scopes §9.4 and §9.5 directly.
