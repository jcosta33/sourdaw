---
name: tauri-platform
description: >-
  Decide whether a subsystem belongs in Web APIs or Rust/Tauri, and keep the
  shell a thin bridge. ALWAYS apply when placing a subsystem on the web-vs-native
  boundary, writing or changing a Tauri command/event/channel or IPC payload,
  handling macOS/Windows/Linux runtime differences, or configuring platform-specific
  behavior — even if it looks like a one-line "put it in Rust" decision. Skip
  browser-only UI with no native boundary, and core domain logic that never
  crosses it.
---

## Purpose

Should this live in Web APIs or in Rust/Tauri? Bad placement causes unnecessary native complexity, poor portability, shell-owned business logic, and fragile cross-platform behavior.

## Core rules

### 1. Place by capability, not convenience — browser unless the browser is weak or absent

| Prefer Web APIs when | Prefer Rust/Tauri when |
|---|---|
| the browser already owns the problem | browser API missing on key target platforms |
| cross-platform support is strong enough | support too fragmented |
| low-latency browser execution is viable | native hardware or filesystem access required |
| coupled to browser rendering/audio primitives | plugin hosting required |
| native would add complexity without benefit | platform normalization easier natively, or browser security/capability limits block the feature |

Ask before placing a subsystem: (1) does the browser API exist on all key targets, (2) is it reliable under real product constraints, (3) is the browser the natural owner, (4) would native meaningfully reduce risk, (5) would native thicken the shell unnecessarily, (6) can the business logic stay independent of this choice?

Typical split: Web for browser audio graph, AudioWorklet DSP, Canvas/WebGL surfaces, browser-side WASM; Rust/Tauri for MIDI I/O, native plugin hosting, native file dialogs/filesystem, weak codec support, heavier local inference, device/platform integration.

**Why:** web-native code is portable by default; native is justified by capability gaps, not convenience.

### 2. Tauri is a bridge, not the business core

Tauri code exposes commands, relays events/channels, translates payloads, and manages platform-specific integration. It must not own domain rules, feature truth, or multi-step business workflows — and must not absorb arbitrary logic because it is nearby.

Design for Linux as the realism floor (WebGPU, media APIs, hardware access). Align dev/prod capability assumptions. Push platform differences behind the bridge.

**Why:** a shell that owns domain truth forks the workflow into two places; silent platform assumptions ship as works-on-my-Mac bugs.

### 3. Commands for one-shot requests; events/channels for ongoing feedback

Use **commands** for explicit one-shot requests (open/save, file dialog, list MIDI ports, load plugin metadata). Use **events/channels** for streamed or ongoing feedback (progress, token streaming, device notifications, metering relays).

**Why:** a one-shot modeled as a stream (or a stream as repeated commands) fights the transport.

### 4. Keep transport payloads explicit and free of runtime internals

Payloads crossing the bridge must be serializable, typed, minimal, and stable. Do not leak native/runtime handles over IPC — explicit DTOs only. Frontend Tauri I/O belongs only in module-root `src/modules/<M>/repositories/` (including `Common/` and `Supporting/` namespaces) or the exact `src/utils/tauriBridge.ts` adapter. Only `src/utils/__tests__/tauriBridge.spec.ts` may mock the adapter dependencies; nested `useCases/repositories` and `presentations/repositories` folders, all other `src/**` origins, and non-allowlisted bridge callers are forbidden; depcruise enforces `tauri-ipc-only-in-repositories` as an **error**.

**Why:** a runtime handle over IPC couples the frontend to Rust internals and breaks on native refactors.

### 5. Empirically verify the FFI bridge

When modifying Tauri commands, events, or state models: align hand-maintained invoke call sites and DTOs (there is **no** Specta→TypeScript export pipeline today — Cargo does not regenerate frontend bindings). Prove alignment with `pnpm cargo:check -- -p sourdaw` and `pnpm typecheck`.

**Why:** serialization mismatches are invisible to a mental model and only surface at the compiler.

## What does not belong

- Module-boundary / barrel / use-case layout rules (those are architecture skills).
- Plugin-host internals beyond “hosting is native” (scanning, RT host/plugin comms).

## References

- [docs/architecture/02-rust-backend.md](../../../docs/architecture/02-rust-backend.md) — crate layout and Tauri bridge role.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — system placement.
- [src-tauri/AGENTS.md](../../../src-tauri/AGENTS.md) — command inventory and RT invariants.
- `.dependency-cruiser.cjs` — `tauri-ipc-only-in-repositories`.
