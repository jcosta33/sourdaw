---
type: spec
id: SPEC-project-durability
subject: stop the silent project-loss path; make every persistence write observed
status: ready
repo: sourdaw
date: 2026-08-01
governs: ADR 0013
blocked_by: nothing
blocks: ADR 0014 phases 1-3, and every measurement the ultracode programme depends on
sources:
  - .agents/decisions/0013-retire-the-flat-json-project-snapshot.md
  - .agents/artifacts/sourdaw/RESEARCH-project-persistence.md
---

# Project durability — Phase 0

Everything here is correct under all four candidate persistence architectures and prejudges none of
them (ADR 0013, Non-goals). It ships before the architecture is chosen, because every later
measurement is taken on a store that can currently revert silently.

## Why this is first

The verification loop for the entire remediation programme is *save → reopen → export → compare*.
Today reopening a project can return a frozen localStorage snapshot and overwrite good CRDT state
from it. An agent that cannot trust reload will destroy the fixtures it builds to measure with.

## Acceptance criteria

Each AC states the observable behaviour and the evidence that settles it. Every guard must be
mutation-checked: name the assertion that goes red.

### AC-1 — No project content is written to localStorage

`localStorage` holds the recent-projects index and pointers only: bounded metadata, no project
document, no audio, no base64.

**Evidence:** a spec that saves a project containing at least 60 seconds of stereo audio and asserts
that no `localStorage` key exceeds a stated small byte ceiling, and that no value parses as
`ProjectData`. Mutation: restoring the dual-write reds it.

### AC-2 — Every persistence write is observed before it is reported

No write path resolves on `request.onsuccess`; every one resolves on `transaction.oncomplete` and
rejects on `onerror` and `onabort`. No write path silently no-ops when the database handle is not
yet open — the ready state is awaited, not null-checked.

**Evidence:** `storageSupport.idbPut` returns a promise that rejects on abort; a spec that aborts a
transaction and asserts the caller sees a rejection; a spec that calls the write before the open has
resolved and asserts the write still lands. Mutation: reverting to `onsuccess`, or restoring the
`if (!db) return`, reds each.

Note the correct pattern already exists in this repo — `saveAllToIdb`, `saveIncrementalsToIdb` and
`replaceAllInIdb` all do this. Match them rather than inventing a second shape. `saveDocToIdb`
resolves on `onsuccess` and has zero production importers: delete it.

### AC-3 — A save that did not commit is not reported as success

`saveProject` returns success only when the write is observed to have committed, and
`addToRecentProjects` is gated on that observation. A listed recent project always points at
something that exists.

**Evidence:** a spec that forces the write to abort and asserts `saveProject` reports failure **and**
that no recent entry was added. Mutation: making the gate unconditional reds it.

### AC-4 — Reads resolve by provenance, never by "a copy is present here"

`readNamedProjectJson`'s presence-preferring fallback is gone. Where more than one copy can exist
during migration, the newer one wins and the rule is explicit.

**Evidence:** a spec with a stale mirror and a fresh primary that asserts the fresh one loads.
Mutation: restoring `if (local !== null) return local` reds it.

### AC-5 — Base64 PCM is gone from every live persistence path

Both producer chains: `buildProjectData` → `exportCachedAudioBuffers`, and `decodeDawProjectAssets`
→ `serializeAudioBuffersForProject` → `audioBufferCache.serializeBuffers`. Three `float32ToBase64`
call sites, two entry points — find them all. The runtime cache already stores raw `Float32Array`
structured-cloned into IndexedDB; that is the copy to use.

Base64 may survive **only** inside an explicit user-initiated export, and only until ADR 0014
decides the export format.

**Evidence:** a spec asserting no live save path calls `float32ToBase64`; and a measurement of
main-thread time for a save of 5 minutes of stereo audio, before and after, quoted in the PR. The
current cost is ~420 ms/min stereo in the encoder alone.

### AC-6 — Existing localStorage snapshots are recovered, not discarded

On upgrade, an existing `sourdaw:project:*` snapshot is read, written through the correct path, and
only then removed. A snapshot that has not been successfully rewritten is never deleted.

**Evidence:** a spec that seeds a snapshot, runs the upgrade, asserts the project is loadable from
the correct store, and asserts the key is gone. A second spec where the rewrite fails, asserting the
key survives. Mutation: removing the write-succeeded gate reds the second.

### AC-7 — The two `.sdaw` codecs are proven to agree

Gate M9. A golden fixture written by the Rust codec is decoded by a Vitest spec, and a fixture
written by the TypeScript codec is decoded by a Rust test. Roughly thirty lines.

This is here because it is cheap and because any divergence is a **shipped web/desktop
incompatibility that exists right now**, independent of everything else in this spec.

**Evidence:** both directions green, with the fixtures checked in. If they disagree, stop and report
— that is a separate defect and a separate decision.

### AC-8 — The blocked stop condition is checked before the mirror is removed

Before deleting any localStorage snapshot, establish how often IndexedDB was actually written. If
the `if (!db) return` early-return path turns out to be common in practice, recent-projects has been
operating off localStorage all along, there is no IndexedDB copy to fall back to, and this stops
being a cleanup and becomes user-data recovery.

**Evidence:** state the finding explicitly in the PR either way. If it fires, **stop and escalate**
rather than proceeding — see ADR 0013, Stop condition.

## Out of scope

Per-project CRDT addressing (`loadProject(id)`, project UUID as the document id) — that is ADR 0014
Phase 1 and depends on the architecture choice. The directory layout, the OPFS worker, the Rust
project store, the ZIP container, the export format, and whether `.sdaw` or `.sourdaw` survives —
all ADR 0014, all gated on measurements.

Do not widen this spec to reach them. Its value is that it is safe under every candidate.

## Verification

- Failing reproduction first for each behavioural AC, with real output pasted.
- Full suite at least twice, both exit codes quoted, read from the command itself.
- `scripts/health-gates-web.sh` and `health-gates-server.sh` from a clean checkout installed off the
  lockfile.
- Every guard mutation-checked with the reding assertion named.
