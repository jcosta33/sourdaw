---
type: adr
id: 0008
title: Recent-projects load uses flat-JSON snapshots (Option A)
status: superseded by 0013
date: 2026-07-16
owner: The Sourdaw team
sources:
  - .agents/findings/inventory-decisions-backlog.md
---

# 0008 — Recent-projects load uses flat-JSON snapshots (Option A)

> **Superseded by [0013](0013-retire-the-flat-json-project-snapshot.md) on 2026-08-01.** The bridge
> this ADR adopted became a silent data-loss path: the localStorage snapshot write fails past quota
> at roughly ten seconds of stereo audio, `setItem` throws before mutating so the undersized copy
> survives, and `readNamedProjectJson` prefers the localStorage copy whenever it is *present* rather
> than when it is current — so the frozen snapshot loads and is then written back over good CRDT
> state. The diagnosis in this ADR was sound and the bridge was labelled honestly; the blast radius
> was larger than its cost table anticipated. Option B (per-project addressing) is carried forward
> into [0014](0014-project-persistence-architecture.md).

## Context

The recent-projects UI (`RecentProjectsMenu.tsx`, `LaunchScreen.tsx`) calls
`loadRecentProject(key)`, which reads a flat-JSON `ProjectData` blob via
`readNamedProjectJson` under a `sourdaw:project:*` key. No producer wrote any
such key — `writeNamedProjectJson` had zero production callers — and the app
persisted only the single *active* project to CRDT (`loadProject()` takes no
id). Selecting a recent project therefore loaded nothing.

Fixing this required a persistence-model call between two options:

- **Option A — flat-JSON snapshots.** Have `saveProject` dual-write the
  serialized `ProjectData` to the named key the recent entry uses
  (`sourdaw:project:${createdAt}`), restoring the backend `loadRecentProject`
  already expects. Lowest-risk, but recent-project load returns a save-time
  snapshot, not live CRDT state.
- **Option B — per-project CRDT docs.** Give each project its own CRDT doc keyed
  by id, store the doc id in the recent entry, and add a `loadProject(id)` path.
  Aligns with the single-source-of-truth CRDT model; larger change touching CRDT
  lifecycle + the recent-entry data model.

## Decision

Adopt **Option A** as the near-term fix, shipped in commit `b8a9cb3f`.
`saveProject` writes the serialized `ProjectData` snapshot under the recent
entry's key (`sourdaw:project:${createdAt}`) after CRDT persistence succeeds,
via one shared `buildProjectData` serializer; CRDT remains the live active doc.
A save → list → load round-trip regression test accompanies the change.

Option A is explicitly a **bridge**: it unbreaks the feature now with a
contained change while keeping a snapshot-vs-live divergence (the recent entry
loads a save-time snapshot that drifts from the CRDT doc after the next edit).

## Non-goals

- Do not treat the flat-JSON snapshot as a second source of truth for live
  editing — CRDT remains the live active document.
- Do not build per-project CRDT lifecycle in this decision (that is Option B).
- Do not add a `loadProject(id)` path here.

## Open questions

- **Option B migration.** Per-project CRDT docs make the recent list load *live*
  project state from the single source of truth instead of a drifting snapshot,
  and would retire the parallel localStorage/IDB named-JSON persistence surface
  entirely (one persistence model, not two). This remains the likely long-term
  direction and is tracked in `open-decision-docket.md` (Project). It warrants
  its own change plan: CRDT lifecycle + recent-entry data model + a
  `loadProject(id)` path + a Project spec AC for the save → list → load
  round-trip.
- Policy for legacy/oversized localStorage projects that exceed quota, and
  whether `recentProjects` should survive project deletion, remain open (docket,
  Project).

## Alternatives considered

| Alternative | Why rejected (as the near-term fix) |
|---|---|
| Option B — per-project CRDT docs now | Larger change touching CRDT lifecycle and the recent-entry data model; not warranted as an immediate unbreak, kept as the long-term direction. |
| Leave `loadRecentProject` broken / hide the recent list | Removes a shipped feature surface rather than fixing it; the backend the UI already expects only needed a producer. |
| Point the recent entry at the single active CRDT doc | All recent entries would resolve to the same active project; there is no per-id CRDT addressing without Option B. |

## Consequences

- Positive: recent-projects load works again with a contained, tested change; one
  shared `buildProjectData` serializer feeds both export and the snapshot write.
- Negative: a recent entry loads a save-time snapshot that can drift from the
  live CRDT doc after subsequent edits, and a parallel named-JSON persistence
  surface persists until Option B retires it.
- Neutral: the snapshot key scheme (`sourdaw:project:${createdAt}`) matches what
  the recent entry already carried.

## Status

accepted

Records Option A as shipped in commit `b8a9cb3f`; Option B remains the likely
long-term direction (open).

## Follow-up work

Schedule the Option B change plan when per-project CRDT persistence is
prioritized: per-project CRDT doc lifecycle, recent-entry data-model update, a
`loadProject(id)` path, and a Project spec AC for the round-trip. Retire the
flat-JSON snapshot surface as part of that work.

## Affected requirements

- Project persistence: recent-projects save → list → load round-trip.
- A future Project spec AC should govern the Option B round-trip when scheduled.
