---
type: adr
id: 0016
title: Ultracode session scope — browser-capable work only, built properly, no compatibility shims
status: accepted
date: 2026-08-01
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md
  - .agents/decisions/0012-neither-target-degrades-the-other.md
---

# 0016 — Ultracode session scope and standard

## Context

The whole-application survey returned 134 findings spanning the browser app, the Rust DSP crates,
the Tauri desktop boundary and the native plugin host. Its programme phases them without ruling on
which are in scope, and several of its §3 owner decisions assumed existing projects had to be
protected.

Four rulings settle the scope and the standard.

## Decision

**1. Desktop is not in scope for this work.** Anything whose home is the Tauri boundary — the ACL,
`start_native_engine`, the native plugin host and its transport, native CRDT persistence, native
Crumbs disk streaming — is deferred. Survey Phase 4 in its entirety is out.

This does not weaken ADR 0012. Building the web side properly does not degrade desktop; it leaves
desktop unimproved, which is a different thing. What 0012 forbids is *capping* one target with the
other's limits, and that constraint stands: no web decision is made smaller because a webview cannot
follow.

**2. Everything that can run in the browser, we build.** This is the scope rule, and it resolves the
survey's largest theme — 28 findings where a user-reachable control terminates in nothing. The
default for an inert browser-capable capability is **build it**, not remove it. Several are cheaper
than the survey assumed: Bacteria's Breakdown and Smudge processors already exist in
`bacteria/stft.rs` and are simply never instantiated; `crumbs::modes` already builds correct
`VoiceTriggerParams` and has no caller. Those are wiring, not invention.

**3. There are no users. Correctness wins outright.** No compatibility shims, no version-gated legacy
behaviour, no permanent branches preserving a known-wrong result. Fix Gluten's +6.31 dB oversampler
gain, report Knead's latency to PDC, render offline automation, restore device state that was being
dropped — and do not carry a legacy path for any of them.

**4. The collaboration role scaffold is deleted.** `canControlTransport`, `getRole`, the transport
capability and the `viewer` role are unreachable — `editor` is the only state ever granted. Remove
the machinery and document plainly that an invite string is unconditional write access. Leaving it
guarantees the next feature built on it believes it enforces something.

## Consequences

- **Survey Phase 4 is dropped.** Two of the four blockers (the Tauri ACL grant, the unreachable
  native engine) go with it, along with the per-quantum JSON IPC, in-process `dlopen`, the
  off-main-thread CLAP GUI, and the MTS-ESP stub. They stay recorded as findings; they are not this
  session's work.
- **ADR 0014 is affected and must be re-read before its gates are run.** Option C is "one logical
  layout, two filesystem implementations" — the desktop implementation is now deferred, so the web
  half (OPFS behind a dedicated worker) proceeds and the Rust project store waits. The
  path-addressed byte-store port should still be designed as a port so the desktop side drops in
  later without redesign. Gates M1, M2, M3 and M7 partly concern webview behaviour; run the web-side
  parts and record the desktop parts as unmeasured rather than deleting them.
- **Several ADR 0014 owner decisions collapse.** "Does the first export of a pre-existing project
  warn", "restore only for projects saved after version N", and the version-gated legacy-gain branch
  are all answered by ruling 3: no. What survives as genuinely open is the shape of a project file
  and where audio lives.
- **Ruling 2 grows the programme.** Nine subsystems move from "decide" to "build". Two of them —
  RAVE timbre transfer and the DDSP/TF.js instrument family — are substantial ML work whose
  browser-capability is itself unproven. That is a measurement, not a decision: establish whether the
  models run in-browser at acceptable cost before committing to a shape, and report the number.
- **Ruling 3 removes a large class of migration work** and the corpus that would have supported it.

## Non-goals

Not a decision to delete desktop support or to stop shipping the Tauri build. Desktop work resumes
when it is scoped; ADR 0012 governs it when it does.

Not licence to break the desktop build carelessly. If a web-side change makes the desktop build fail,
record it where the desktop work will find it.

## Status

accepted
