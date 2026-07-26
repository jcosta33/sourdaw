---
type: adr
id: 0012
title: Agent command registry packaging and authoritative write boundary
status: accepted
date: 2026-07-26
owner: The Sourdaw team
sources:
  - DECISIONS-sourdaw-agentic-production-system D-001 and D-003
  - SPEC-sourdaw-agentic-production-system AC-001, AC-006, and AC-017
---

# 0012 — Agent command registry packaging and authoritative write boundary

## Context

`AppAction` is the reusable migration primitive, while `RuntimeAction` and other
producer-specific schemas create competing action censuses. Project loading must
also remain independent of replaying historical command implementations.

## Decision

Wrap `AppAction` in a versioned `DawCommandV1` envelope. Derive both `AppAction`
and `DawCommandV1`, along with descriptors, schemas, risks, inverses, and
receipts, from Command's one descriptor registry. Retire `RuntimeAction` as a
second census.

Every semantic project mutation, accepted preview, undo, redo, compensation,
import-created project reference, and project-backed decision enters Command.
Ephemeral UI, run, worker, cache, capability, status, meter, and derived-index
state stays with its owner. Canonical projects load materialized state; obsolete
commands are audit records, never a replay requirement.

## Consequences

- Existing handlers remain reusable during migration.
- The registry is the only command-discovery and operation-version authority.
- Runtime state does not become project truth merely because an agent observes it.
