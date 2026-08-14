---
type: spec
id: SPEC-mts-esp-host
title: MTS-ESP master — retune third-party plugins
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# MTS-ESP master — retune third-party plugins

## Intent

Make Sourdaw an MTS-ESP master so hosted third-party plugins (Surge XT, Serum, Pianoteq)
follow the project tuning live. Implement the full `libMTS` master lifecycle in
`daw-engine`, support 16-channel per-channel tunings, deliver updates independent of audio
sample rate, and surface a client diagnostics panel — with single-master arbitration on
the machine.

## Non-goals

- The internal tuning table and microtonal math (see `microtuning-engine`).
- Scala file parsing (see `scala-tuning-formats`).
- Tuning Sourdaw's own native instruments (handled by `microtuning-engine`).

## Requirements

### AC-001 — Master lifecycle

A `MtsEspMaster` service must call `MTS_RegisterMaster` on engine start,
`MTS_SetNoteTunings`/`MTS_SetScaleName`/`MTS_FilterNote` on change, and
`MTS_DeregisterMaster` exactly once on shutdown (no "master still registered" warning on
next launch).

Verify with: `pnpm cargo:test -- -p daw-engine mts_master_lifecycle`

### AC-002 — Plugin latches on

Launching with Surge XT loaded must light Surge's "MTS-ESP: connected" indicator within ≤2 s
of instantiation.

Verify with: `manual` — load Surge XT, confirm "MTS-ESP: connected" within 2 s

### AC-003 — Tuning change propagates rate-independently

Changing 12-TET → 31-EDO must update Surge XT, Serum, and Pianoteq within ≤50 ms of the UI
commit regardless of buffer size or sample rate.

Verify with: `manual` — switch to 31-EDO on the reference session; confirm all three plugins retune within 50 ms

### AC-004 — Single-master arbitration

With another master already registered, Sourdaw must detect it (`MTS_HasMaster`) and run in
client-mode indicator state instead of force-registering.

Verify with: `pnpm cargo:test -- -p daw-engine mts_single_master_guard`

### AC-005 — Client diagnostics panel

A diagnostics panel must list each connected client by reported name and update live as
plugins are inserted/removed.

Verify with: `manual` — insert and remove a plugin; confirm the client list updates live

### AC-006 — libMTS provisioning

First-run setup must place `libMTS` at the platform-standard path with user consent on
macOS and Windows.

Verify with: `manual` — run first-run setup on a clean machine; confirm libMTS lands at the standard path

## Open questions

- [ ] (non-blocking) Bundle `libMTS` vs discover-and-install. Default: discover, offer
  install on first run.

## Affected areas

- `crates/daw-engine/` (`MtsEspMaster`), Tauri bridge
- diagnostics panel UI, first-run setup flow

## Dropped from sources

- None — scopes §10.1 directly.
