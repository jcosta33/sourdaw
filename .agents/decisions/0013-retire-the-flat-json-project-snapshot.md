---
type: adr
id: 0013
title: Retire the flat-JSON project snapshot and its base64 audio
status: accepted
date: 2026-08-01
owner: The Sourdaw team
supersedes: 0008
sources:
  - .agents/artifacts/sourdaw/RESEARCH-project-persistence.md
---

# 0013 — Retire the flat-JSON project snapshot and its base64 audio

## Context

ADR 0008 adopted Option A — `saveProject` dual-writes a serialized `ProjectData` snapshot under the
recent entry's key — as an explicit bridge to unbreak recent-projects loading, with the
snapshot-versus-live divergence recorded as a known negative and per-project CRDT documents named as
the likely long-term direction.

The bridge has a larger blast radius than 0008's cost table anticipated, and the mechanism is now
a silent data-loss path. Established by primary-source research and direct verification against this
repository (`RESEARCH-project-persistence.md`):

- `writeNamedProjectJsonByKey` dual-writes to IndexedDB and localStorage and swallows the quota
  throw with the comment "Quota exceeded — IndexedDB has it" — an assertion about a call whose
  result was never observed.
- `localStorage.setItem` throws **before** mutating the map (HTML §12.2.1), so the previous,
  undersized snapshot survives intact.
- `readNamedProjectJson` prefers the localStorage copy **whenever it is present** — presence, not
  recency. Its own docstring shows the author anticipated quota and built the fallback for
  *absence*; the actual failure mode is *staleness*.
- Loading that frozen snapshot reseeds CRDT authority from it, so every edit made after the project
  first exceeded quota is overwritten.
- `storageSupport.idbPut` returns `void`, never awaits the transaction, and silently no-ops for the
  whole window between page load and the IndexedDB open resolving. An IndexedDB request's `success`
  fires before commit and is not a durability signal (IDB 3.0 §5.6, §2.7.1).
- `saveProject` calls `addToRecentProjects` unconditionally, so a listed project can point at
  nothing.
- The snapshot embeds base64 PCM. Measured: 1.333× expansion fully paid in JSON; ~420 ms/min of
  stereo on the main thread in the app's own `float32ToBase64`; a hard V8 `JSON.stringify` ceiling
  at ~17.5 minutes of stereo audio; and ~10 seconds of stereo audio exhausts localStorage's
  5 MiB registered quota. The runtime cache already stores the same PCM as raw `Float32Array`
  in IndexedDB, so the base64 copy is redundant as well as expensive.

Note what is **not** wrong: the live CRDT write paths are correct. `saveAllToIdb`,
`saveIncrementalsToIdb` and `replaceAllInIdb` all resolve on `tx.oncomplete` and wire `onerror` and
`onabort`. The competent pattern already exists in this codebase; the snapshot layer never adopted
it.

## Decision

**Retire the flat-JSON project snapshot.** Specifically:

1. Delete the localStorage project-snapshot dual-write. localStorage keeps the recent-projects index
   and pointers only — bounded metadata, never content.
2. Delete base64 PCM from every **live** persistence path. It may survive only inside an explicit,
   user-initiated export if a later decision keeps it there.
3. Every persistence write awaits `transaction.oncomplete` and rejects on `onabort`. The storage
   ready-state is awaited, not null-checked.
4. `addToRecentProjects` is gated on an observed successful write.
5. Reads resolve by recency and provenance, never by "a copy is present here".

## Non-goals — and this is the important part

**This ADR does not choose the target persistence architecture.** Four coherent designs are on the
table (CRDT-only; split stores over shared IndexedDB; project-as-directory with per-target
filesystems; fully per-target bindings) and the choice is gated on measurements that do not exist
yet. It is recorded separately as ADR 0014, status `proposed`.

Everything in the Decision above is correct under **all four** options and prejudges none of them.
That is deliberate: the bleeding stops now, and the architecture is chosen on evidence later.

Also not decided here: whether `.sdaw` or `.sourdaw` survives; whether audio is embedded or
referenced in a portable file; per-project CRDT addressing (0008's Option B), which is a
prerequisite for the architecture decision rather than part of this cleanup.

## Consequences

- **Positive.** The silent-loss path is removed. Recent-projects load stops preferring a stale
  mirror. Save stops reporting success for writes that never committed. The main-thread base64 cost
  disappears from every save.
- **Negative.** Recent-projects loading must be re-pointed at a real source. Until per-project CRDT
  addressing lands (0014 Phase 1) the recent list can only address the single active document, so
  this ADR's cleanup and that addressing work are adjacent and should be sequenced together.
- **Migration.** Existing localStorage snapshots may be the only surviving copy of a project whose
  IndexedDB write never landed — see stop condition below. Read them on upgrade, write them through
  the correct path, then remove the key. Do not delete a snapshot that has not been successfully
  rewritten.
- **Neutral.** `.sourdaw` export is unaffected by this ADR; its base64 audio is an export-format
  question deferred to 0014.

## Stop condition

**If removing the localStorage mirror reveals that IndexedDB was frequently never written** — the
`if (!db) return` early-return path being common in practice — then recent-projects has been
operating off localStorage all along, there is no IndexedDB copy to fall back to, and this stops
being a cleanup and becomes user-data recovery. Escalate rather than proceeding.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Fix the read order only (prefer IndexedDB when both exist) | Leaves the base64 cost, the V8 ceiling, the swallowed quota throw and the unobserved write. Treats the newest symptom. |
| Make the failure loud and keep the mechanism | Excalidraw's actual course on the identical bug: issue #8411 (Aug 2024) resolved 13 months later with a toast, no storage change, and the issue is still open. Notification did not close it. |
| Move the same payload to IndexedDB | Moves the wall from ~10 s of audio to the ~17.5 min V8 string ceiling and keeps the encode cost and the presence-over-recency read. |
| Wait for the architecture decision | The data-loss path stays live for the duration, and every measurement taken meanwhile is taken on a store that can silently revert. |

## Status

accepted, superseding 0008

0008 is superseded as to its mechanism (the dual-written flat-JSON snapshot). Its diagnosis and its
Option B direction remain valid input and are carried into 0014.
