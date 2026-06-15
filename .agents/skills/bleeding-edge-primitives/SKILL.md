---
name: bleeding-edge-primitives
type: agent-guide
description: >-
  Reach for modern JS (ES2024–2026) and Rust (2024 Edition) primitives in audio
  DSP, Tauri interop, and memory-efficient DAW state. ALWAYS apply this skill when
  allocating large sample/wavetable buffers, writing AudioWorklet/Worker spin-loops
  or ring buffers, building no-alloc audio-thread DSP, or wiring UI-to-Engine async
  callbacks — even if the task only says "make this faster" or "clean this up". Do
  not reach for older verbose polyfills, manual synchronization, or hand-rolled
  cleanup when a stabilized primitive exists. Skip this skill for product/UI feature
  work with no DSP, buffer, or interop surface, or for tasks pinned to an older
  toolchain that cannot adopt these versions.
---

# Skill: bleeding-edge-primitives

## Purpose

Stop the agent from reaching for stale, verbose, or unsafe patterns (manual `Float32Array`
doubling, hand-rolled cleanup, busy-wait spin-loops, lifetime gymnastics) when a stabilized
modern primitive does the job with less memory, fewer allocations, and safer cleanup. The
failure mode this prevents: an agent that defaults to the patterns in its training data and
silently leaves a slower, allocation-heavy, or thermally wasteful implementation on the audio
thread or interop boundary. Use these to improve performance, memory safety, and ergonomics;
avoid older, more verbose polyfills or manual synchronization.

## Project context (the AGENTS.md contract)

Resolve project commands through the consuming repo's `AGENTS.md` Commands table — `cmdTypecheck`,
`cmdLint`, and `cmdValidate` for the self-review gate, `cmdTest` for behavior, `cmdBuild` to
confirm the toolchain accepts the primitive. If a slot is missing or undefined, ask the user
which command to run before claiming any check passed — do not guess. The toolchain versions
named below (TS 6.0, Rust 1.85+) are the assumed floor; if the project pins an older toolchain,
treat the affected primitive as out of scope and say so rather than introducing a build break.

## Core rules

### 1. Halve buffer memory with `Float16Array`

Use `Float16Array` for large sample libraries or wavetables to halve memory usage vs
`Float32Array`; it has native WebGPU support.
_Why: doubling a `Float32Array` is the lazy default, and for read-mostly sample/wavetable data
the precision loss is inaudible while the memory saving is real — large libraries are where DAW
memory pressure actually bites._

### 2. `Atomics.pause` in shared-memory spin-loops

Use `Atomics.pause` (Stage 3) in AudioWorklet/Worker spin-loops (e.g., ring buffers) to improve
CPU efficiency and reduce thermal throttling. This is also Core Mandate #2 (Efficiency): use it
in shared-memory spin-locks to prevent unnecessary CPU waste.
_Why: a bare busy-wait pins a core at 100% and throttles the whole machine; the pause hint lets
the CPU back off without giving up the low-latency hand-off a ring buffer needs._

### 3. Explicit Resource Management (`using`) for long-lived assets

Use the `using` keyword to automatically clean up `AudioBuffer`, `Worker`, or WASM memory. This
is also Core Mandate #3 (Resource Safety): always use `using` for long-lived DAW assets.

```javascript
{
    using handle = acquireWasmBuffer();
    // handle is freed at the end of block
}
```

_Why: hand-rolled `try/finally` cleanup is where leaks hide — `using` ties the lifetime to the
block scope so a freed WASM buffer or disposed `Worker` can't be forgotten on an early return or
throw._

### 4. Native decorators, `withResolvers`, and group-by helpers

- **Standardized Decorators (TS 6.0)**: use for DI and event metadata. Prefer native
  `@decorator` syntax over legacy experimental modes.
- **`Promise.withResolvers()`**: cleaner "one-shot" async events (e.g., waiting for sample load).
- **`Object.groupBy` / `Map.groupBy`**: the standard way to group tracks, plugins, or MIDI events.

_Why: each replaces a verbose, error-prone hand-roll (experimental-decorator config, the
deferred-promise dance, a manual reduce-into-a-map) with a stabilized one-liner that the next
reader recognizes immediately._

### 5. Compile-time tables and math in Rust DSP

- **`inline_const` (Stable 1.79)**: define lookup tables (LFOs, curves) exactly where they are
  used: `let table = const { generate_lookup() };`.
- **`const_mut_refs` (Stable 1.83)**: perform complex compile-time math (e.g., FFT bit-reversal
  indexing) using mutable logic inside `const` blocks.

_Why: moving table generation and index math to compile time keeps the audio thread allocation-
free (Core Mandate #1) — the work happens once at build, not per-callback._

### 6. Portable SIMD and zero-overhead kernels

- **Portable SIMD (`std::simd`)**: unified DSP code that auto-optimizes for AVX-512 (PC) and NEON
  (Apple Silicon).
- **`naked_functions` (Stable 1.88)**: use for ultra-critical DSP kernels requiring zero-overhead
  assembly interop.
_Why: one `std::simd` body replaces two hand-written intrinsic paths and stays correct on both
target architectures sourdaw ships to; `naked_functions` is the escape hatch for the rare kernel
where even the prologue/epilogue is too much._

### 7. Async ergonomics for Tauri interop

- **Async Closures (`async || {}`)**: simplified callbacks for UI-to-Engine events without
  lifetime "gymnastics."
- **Async Functions in Traits (AFIT)**: native `async` definitions for plugin or module interfaces.
_Why: both remove the boxed-future / lifetime-workaround boilerplate that used to clutter the
interop boundary, so the callback or trait reads as plain async._

### 8. Hold the no-alloc invariant on the audio thread (Core Mandate #1)

Use GATs, Const Generics, and `inline_const` in Rust to maintain "no-alloc" status on the audio
thread. No primitive in this skill is licensed to break it.
_Why: an allocation on the audio callback path is a glitch waiting to happen; the modern
primitives are chosen precisely because they let you express the fast path without allocating._

## What does not belong

- Project-wide stack conventions, the DDD module-boundary rules, and the full RT-safety policy —
  those live in the consuming repo's `AGENTS.md`, not here. This skill names primitives; the
  architecture rules constrain where they go.
- Adopting an unstabilized primitive past the version floor in Project context. `Atomics.pause`
  is Stage 3 and explicitly in scope; anything below stable/Stage 3 is not — flag it as a blocker.
- Using a primitive as cover for a behavior change. These are performance/ergonomics swaps; if
  behavior shifts, that is a different task type.

## Refuses

| 🚩 Temptation | ✅ Do instead |
| --- | --- |
| Allocate a `Float32Array` for a large read-mostly sample bank | `Float16Array` — half the memory, native WebGPU (rule 1) |
| Bare `while (!ready) {}` busy-wait in an AudioWorklet/ring buffer | `Atomics.pause` hint inside the spin-loop (rule 2) |
| Hand-rolled `try/finally` to free a WASM buffer or `Worker` | `using` so cleanup ties to block scope (rule 3) |
| Legacy experimental decorators / deferred-promise dance / manual group reduce | Native `@decorator` (TS 6.0) / `Promise.withResolvers()` / `Object.groupBy` (rule 4) |
| Generate an LFO/curve table at runtime on the audio thread | `inline_const` `const { generate_lookup() }` at compile time (rule 5) |
| Two hand-written AVX-512 + NEON intrinsic paths | one `std::simd` body that targets both (rule 6) |
| Boxed-future / lifetime workaround for a UI-to-Engine callback | async closure `async || {}` or AFIT trait method (rule 7) |
| Any allocation on the audio callback path | GATs / Const Generics / `inline_const` to stay no-alloc (rule 8) |

## Anti-patterns

- Swapping in a primitive without confirming the toolchain accepts it (`cmdBuild` / `cmdTypecheck`
  never run) — a stabilized primitive on paper is still a build break if the project's version is
  below the floor.
- "It compiles, ship it" — a SIMD or `const`-block rewrite can compile and still change numeric
  output; behavior is verified with `cmdTest`, not assumed.
- Reaching for `naked_functions` or `const_mut_refs` for ordinary code — these are the
  ultra-critical / compile-time-math escape hatches, not defaults.
- Introducing `Float16Array` on write-heavy or precision-sensitive accumulation buffers where the
  reduced mantissa actually matters.

## Self-review gate

Run these before declaring the change done, and paste the verbatim output of each into the
self-review. Not complete until every command's output appears verbatim and every box reads true.

1. `cmdTypecheck` — clean. Paste the last two lines.
2. `cmdLint` — clean. Paste the last two lines.
3. `cmdValidate` — no architectural-boundary violations introduced. Paste the last two lines.
4. `cmdBuild` — the toolchain accepts every primitive introduced (no version-floor break). Paste
   the last two lines.
5. `cmdTest` — behavior unchanged where the swap was meant to be behavior-preserving. Paste the
   last two lines.
6. Confirm in prose: every primitive added is stabilized (or Stage 3 for `Atomics.pause`) on the
   project's pinned toolchain, and no change introduced an allocation on the audio callback path
   (Core Mandate #1).

Not complete until the pasted `cmdBuild` and `cmdTest` output and the rule-6 confirmation all
appear verbatim in the self-review.
