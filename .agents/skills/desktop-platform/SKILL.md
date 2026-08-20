---
name: desktop-platform
description: >-
    Decide whether a subsystem belongs in Web APIs or in the native Rust backend,
    and keep the Electron shell a thin bridge. ALWAYS apply when placing a
    subsystem on the web-vs-native boundary, writing or changing a native
    command/event/stream or IPC payload, handling macOS/Windows/Linux runtime
    differences, or configuring platform-specific behavior — even if it looks
    like a one-line "put it in Rust" decision. Skip browser-only UI with no
    native boundary, and core domain logic that never crosses it.
---

## Purpose

Bad web-vs-native placement buys native complexity, kills portability, leaks business logic into the shell, and makes cross-platform behavior fragile.

## Core rules

### 1. Place by capability, not convenience — browser unless the browser is weak or absent

| Prefer Web APIs when                          | Prefer native Rust when                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| the browser already owns the problem          | browser API missing on key target platforms                                                     |
| cross-platform support is strong enough       | support too fragmented                                                                          |
| low-latency browser execution is viable       | native hardware or filesystem access required                                                   |
| coupled to browser rendering/audio primitives | plugin hosting required                                                                         |
| native would add complexity without benefit   | platform normalization easier natively, or browser security/capability limits block the feature |

Typical split: Web for the browser audio graph, AudioWorklet DSP, Canvas/WebGL surfaces, and browser-side WASM; native Rust for MIDI I/O, native plugin hosting, native file dialogs and filesystem, weak codec support, heavier local inference, and device/platform integration.

**Why:** web-native code is portable by default; native is justified by capability gaps, not convenience.

### 2. The shell is a bridge, not the business core

Command bodies live in `crates/sourdaw-native` and know nothing about any shell. The Electron layer (`electron/`) exposes commands over IPC, relays events and streams, translates payloads, and manages platform integration. It never owns domain rules, feature truth, or multi-step business workflows, and never absorbs logic because it is nearby. A command is a body in the crate plus an opaque wrapper in the shell; the wrapper holds no behaviour.

Exposing a command to the renderer is a product decision recorded in `electron/commands.ts` (`EXPOSED_COMMANDS` / `DENIED_COMMANDS`). `electron/__tests__/commands.spec.ts` enforces that the two lists partition the addon's registered surface and that every exposed command has a production caller.

Design for the weakest target as the realism floor (WebGPU, media APIs, hardware access). Align dev and prod capability assumptions. Push platform differences behind the bridge.

**Why:** a shell that owns domain truth forks the workflow into two places; silent platform assumptions ship as works-on-my-Mac bugs.

### 3. Commands for one-shot requests; events/streams for ongoing feedback

**Commands:** open/save, file dialog, list MIDI ports, load plugin metadata. **Events/streams:** progress, token streaming, device notifications, metering relays. The crate-side seams are the traits in `crates/sourdaw-native/src/events.rs`.

**Why:** a one-shot modeled as a stream, or a stream as repeated commands, fights the transport.

### 4. Keep transport payloads explicit and free of runtime internals

Payloads crossing the bridge are serializable, typed, minimal, and stable. Arguments cross **positionally** in addon parameter order — `SOURDAW_COMMAND_ARGUMENTS` in `src/utils/sourdawCommandArguments.ts` is the pinned order. Bulk bytes cross as raw buffers, never JSON number arrays. Never leak a native or runtime handle over IPC; explicit DTOs only.

Frontend desktop I/O belongs only in module-root `src/modules/<M>/repositories/` (including the `Common/` and `Supporting/` namespaces) or the exact `src/utils/desktopBridge.ts` adapter. Only `src/utils/__tests__/desktopBridge.spec.ts` may mock the adapter dependencies. Nested `useCases/repositories` and `presentations/repositories` folders, all other `src/**` origins, and non-allowlisted bridge callers are forbidden; depcruise enforces `desktop-ipc-only-in-repositories` as an **error**.

**Why:** a runtime handle over IPC couples the frontend to Rust internals and breaks on native refactors.

### 5. Empirically verify the FFI bridge

There is **no** binding-generation pipeline — Cargo does not regenerate frontend types. When changing native commands, events, or state models, align hand-maintained invoke call sites and DTOs, then prove it with `pnpm cargo:test --package sourdaw-native <filter>`, `pnpm typecheck`, and `pnpm test:run electron/__tests__/commands.spec.ts` (signature and argument-order parity lives there).

**Why:** serialization mismatches are invisible to a mental model and only surface at the compiler or the parity spec.

## Out of scope

Module-boundary, barrel, and use-case layout rules (architecture skills). Plugin-host internals beyond "hosting is native" — see `plugin-hosting`.

## References

- [docs/architecture/02-rust-backend.md](../../../docs/architecture/02-rust-backend.md) — crate layout and shell bridge role.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — system placement.
- [crates/sourdaw-native/AGENTS.md](../../../crates/sourdaw-native/AGENTS.md) — shell independence and RT invariants.
- `.dependency-cruiser.shared.cjs` — `desktop-ipc-only-in-repositories`.
