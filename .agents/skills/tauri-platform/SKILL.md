---
name: tauri-platform
description: >-
  Decide whether a subsystem belongs in Web APIs or Rust/Tauri, and keep the
  shell a thin bridge. ALWAYS apply when placing a subsystem on the web-vs-native
  boundary, writing or changing a Tauri command/event/channel or IPC payload,
  handling macOS/Windows/Linux runtime differences, or configuring platform-specific
  behavior — even if it looks like a one-line "put it in Rust" decision. Do not let
  a Tauri command own domain rules, leak runtime handles over IPC, or assume a
  browser API exists on every platform. Skip browser-only UI with no native
  boundary, and core domain logic that never crosses it.
---

## Purpose

This skill answers one systems question — should this live in Web APIs or in Rust/Tauri? — and keeps the answer from corrupting the architecture. Bad placement causes unnecessary native complexity, poor portability, shell-owned business logic, and fragile cross-platform behavior. It is a decision framework plus the discipline that keeps the shell thin.

## Core rules

### 1. Use the browser when the browser is the natural owner

Prefer Web APIs when the browser already owns the problem, cross-platform support is strong enough, low-latency browser execution is viable, the feature is tightly coupled to browser rendering/audio primitives, or moving it native would add complexity without architectural benefit.

**Why:** web-native code is portable by default; moving a solved browser problem into Rust buys shell thickness with no architectural return.

### 2. Use Rust/Tauri when the browser is fundamentally weak or absent

Prefer Rust/Tauri when the browser API does not exist on key target platforms, support is too fragmented, native hardware or filesystem access is required, plugin hosting is required, reliable platform normalization is easier natively, or browser security/capability limits make the feature impractical.

**Why:** native is justified by capability gaps, not convenience.

### 3. Tauri is a bridge, not the business core

Tauri code should expose commands, relay events/channels, translate payloads, and manage platform-specific integration. It must not own domain rules, feature truth, or multi-step business workflows.

**Why:** when the shell owns domain truth, the same workflow exists in two places and the frontend cannot be reasoned about without reading Rust.

### 4. Apply the placement decision process before placing a subsystem

Ask, in order:

1. Does the required browser API exist on all key target platforms?
2. Is the browser path reliable enough under real product constraints?
3. Is the browser already the natural runtime owner?
4. Would a native implementation meaningfully reduce risk?
5. Would moving this native thicken the shell unnecessarily?
6. Can the business logic remain independent of this placement choice?

Typical split: prefer Web for browser audio graph, AudioWorklet DSP, Canvas/WebGL surfaces, browser-side WASM; prefer Rust/Tauri for MIDI I/O, native plugin hosting, native file dialogs/filesystem, weak codec support, heavier local inference, device/platform integration.

**Why:** a written order forces placement by capability and product constraints, not by whichever runtime felt easier.

### 5. Commands for one-shot requests; events/channels for ongoing feedback

Use **commands** for explicit one-shot requests (open/save, file dialog, list MIDI ports, load plugin metadata). Use **events/channels** for streamed or ongoing feedback (progress, token streaming, device notifications, metering relays).

**Why:** a one-shot modeled as a stream (or a stream as repeated commands) fights the transport.

### 6. Keep transport payloads explicit and free of runtime internals

Payloads crossing the bridge must be serializable, typed, minimal, and stable. Do not leak native/runtime handles over IPC — explicit DTOs only. Frontend I/O of Tauri stays in repositories (`tauri-ipc-only-in-repositories`).

**Why:** a runtime handle over IPC couples the frontend to Rust internals and breaks on native refactors.

### 7. Empirically verify the FFI bridge

When modifying Tauri commands, events, or state models: align hand-maintained invoke call sites and DTOs (there is **no** Specta→TypeScript export pipeline today — `cargo test` / `cargo build` do not regenerate frontend bindings). Prove alignment with `cargo check -p sourdaw` and `pnpm typecheck`.

**Why:** serialization mismatches are invisible to a mental model and only surface at the compiler.

### 8. Keep the shell thin; design platform differences deliberately

The shell may translate requests, expose native capabilities, manage platform setup, and relay transport-safe state. It must not become the domain layer or absorb arbitrary workflow logic because it is nearby.

Design for Linux as the realism floor (WebGPU, media APIs, hardware access). Align dev/prod capability assumptions. Push platform differences behind the bridge where possible.

**Why:** “native is faster/easier” is not architecture; silent platform assumptions ship as works-on-my-Mac bugs.

## What does not belong

- Domain rules, feature truth, or business workflows inside a Tauri command body.
- Runtime handles and unstable native shapes crossing IPC.
- Module-boundary / barrel / use-case layout rules (those are architecture skills).
- Plugin-host internals beyond “hosting is native” (scanning, RT host/plugin comms).

## Anti-patterns

### CRITICAL — Tauri command owns domain rules

❌ Wrong: command validates domain rules, mutates project truth, coordinates multi-step workflows.

✅ Correct: thin entry point that delegates into core/application service logic.

### CRITICAL — Runtime handles over IPC

❌ Wrong: send native plugin handles or non-serializable objects to the frontend.

✅ Correct: explicit serializable DTOs only.

### HIGH — “Put it in Rust” for convenience

❌ Wrong: move a hard feature native because the web path felt annoying.

✅ Correct: move only when the browser is absent or fragile on target platforms (rule 4).

### HIGH — Unverified FFI change

❌ Wrong: trust that the Rust→TS payload “looks right”.

✅ Correct: update hand-written IPC DTOs/call sites; paste green `cargo check -p sourdaw` and `pnpm typecheck`.

### MEDIUM — Platform checks littered through feature code

❌ Wrong: `if (mac) … else if (win) …` through domain modules.

✅ Correct: push differences behind the bridge; intentional fallbacks at the edge.

## References

- [docs/architecture/02-rust-backend.md](../../../docs/architecture/02-rust-backend.md) — crate layout and Tauri bridge role.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — system placement.
- `.dependency-cruiser.cjs` — `tauri-ipc-only-in-repositories`.
