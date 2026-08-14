# Modern JS & Rust primitives

A reference for the current-edition language primitives worth reaching for in
sourdaw's hot, real-time, and interop-heavy code. The intent is simple: prefer
current-edition JS (ES2024–2026) and Rust (1.85+ toolchain, edition 2021) primitives over verbose
polyfills, manual synchronization, or allocation-heavy idioms on hot and RT-audio
paths. The failure mode this guards against is defaulting to older,
training-data-shaped patterns — manual `Float32Array` doubling, hand-rolled
cleanup, busy-wait spin-loops, lifetime gymnastics — and silently leaving a
slower, allocation-heavy, or thermally wasteful implementation on the audio thread
or interop boundary.

Use these to improve performance, memory safety, and ergonomics in audio DSP,
AudioWorklet/Worker code, WASM memory handling, Tauri interop, and memory-efficient
DAW state.

## Version floor

The primitives below assume a **TypeScript 6.0** and **Rust 1.85+** toolchain as the
floor. If the project pins an older toolchain, treat the affected primitive as out of
scope rather than introducing a build break. Resolve and run the affected toolchain checks
(`pnpm typecheck`, `pnpm deps:validate`, `pnpm build`, `pnpm lint <files>`, or
`pnpm test:run <path>`) before relying on any swap —
a stabilized primitive on paper is still a build break if the project's version is
below the floor.

These are performance and ergonomics swaps, not behavior changes. A SIMD or
`const`-block rewrite can compile and still change numeric output, so verify
behavior with affected tests rather than assuming it. If behavior shifts on purpose,
that is a different kind of change.

---

## JavaScript / TypeScript primitives

### `Float16Array` — halve buffer memory

Use `Float16Array` for large sample libraries or wavetables to halve memory usage vs
`Float32Array`; it has native WebGPU support.

_Why:_ doubling a `Float32Array` is the lazy default, and for read-mostly
sample/wavetable data the precision loss is inaudible while the memory saving is real
— large libraries are where DAW memory pressure actually bites.

**Caveat:** do not introduce `Float16Array` on write-heavy or precision-sensitive
accumulation buffers, where the reduced mantissa actually matters.

### `Atomics.pause` — back off in shared-memory spin-loops

Use `Atomics.pause` (Stage 3) in AudioWorklet/Worker spin-loops (e.g. ring buffers)
to improve CPU efficiency and reduce thermal throttling. Reach for it in
shared-memory spin-locks to prevent unnecessary CPU waste.

_Why:_ a bare busy-wait pins a core at 100% and throttles the whole machine; the
pause hint lets the CPU back off without giving up the low-latency hand-off a ring
buffer needs.

**Caveat:** `Atomics.pause` is at Stage 3. It is the one not-yet-fully-stable
primitive deliberately in scope here; anything below stable / Stage 3 is not — flag
it rather than adopting it.

### Explicit Resource Management (`using`) — long-lived assets

Use the `using` keyword to automatically clean up `AudioBuffer`, `Worker`, or WASM
memory.

```javascript
{
    using handle = acquireWasmBuffer();
    // handle is freed at the end of block
}
```

_Why:_ hand-rolled `try/finally` cleanup is where leaks hide — `using` ties the
lifetime to the block scope so a freed WASM buffer or disposed `Worker` can't be
forgotten on an early return or throw.

### Native decorators, `withResolvers`, and group-by helpers

- **Standardized decorators (TS 6.0):** usable for event metadata. Prefer native
  `@decorator` syntax over legacy experimental modes. (DI in this repo is `inject()`/`Container` — see `docs/01-dependency-injection.md` — not decorators.)
- **`Promise.withResolvers()`:** cleaner "one-shot" async events (e.g. waiting for a
  sample to load).
- **`Object.groupBy` / `Map.groupBy`:** the standard way to group tracks, plugins, or
  MIDI events.

_Why:_ each replaces a verbose, error-prone hand-roll (experimental-decorator config,
the deferred-promise dance, a manual reduce-into-a-map) with a stabilized one-liner
that the next reader recognizes immediately.

---

## Rust primitives

### Compile-time tables and math in DSP

- **`inline_const` (stable 1.79):** define lookup tables (LFOs, curves) exactly where
  they are used: `let table = const { generate_lookup() };`.
- **`const_mut_refs` (stable 1.83):** perform complex compile-time math (e.g. FFT
  bit-reversal indexing) using mutable logic inside `const` blocks.

_Why:_ moving table generation and index math to compile time keeps the audio thread
allocation-free — the work happens once at build, not per-callback.

**Caveat:** `const_mut_refs` is a compile-time-math escape hatch, not a default —
reach for it only for the genuine compile-time math case, not ordinary code.

### Portable SIMD and zero-overhead kernels

- **Portable SIMD (`std::simd`, nightly-only — `portable_simd` feature):** unified DSP code that auto-optimizes for AVX-512
  (PC) and NEON (Apple Silicon).
- **`naked_functions` (stable 1.88 — above the 1.85 floor; gate on the pinned nightly):** for ultra-critical DSP kernels requiring
  zero-overhead assembly interop.

_Why:_ one `std::simd` body replaces two hand-written intrinsic paths and stays
correct on both target architectures sourdaw ships to; `naked_functions` is the
escape hatch for the rare kernel where even the prologue/epilogue is too much.

**Caveat:** `naked_functions` is the ultra-critical escape hatch, not a default. A
SIMD rewrite can compile and still change numeric output — verify with the test
suite.

### Async ergonomics for Tauri interop

- **Async closures (`async || {}`):** simplified callbacks for UI-to-Engine events
  without lifetime "gymnastics."
- **Async functions in traits (AFIT):** native `async` definitions for plugin or
  module interfaces.

_Why:_ both remove the boxed-future / lifetime-workaround boilerplate that used to
clutter the interop boundary, so the callback or trait reads as plain async.

### Hold the no-alloc invariant on the audio thread

Use GATs, const generics, and `inline_const` in Rust to maintain "no-alloc" status on
the audio thread. No primitive here is licensed to break it.

_Why:_ an allocation on the audio callback path is a glitch waiting to happen; the
modern primitives are chosen precisely because they let you express the fast path
without allocating.

---

## Quick reference

| Reach for… | Instead of… |
| --- | --- |
| `Float16Array` — half the memory, native WebGPU | a `Float32Array` for a large read-mostly sample bank |
| `Atomics.pause` hint inside the spin-loop | a bare `while (!ready) {}` busy-wait in an AudioWorklet / ring buffer |
| `using` so cleanup ties to block scope | hand-rolled `try/finally` to free a WASM buffer or `Worker` |
| native `@decorator` (TS 6.0) / `Promise.withResolvers()` / `Object.groupBy` | legacy experimental decorators / deferred-promise dance / manual group reduce |
| `inline_const` `const { generate_lookup() }` at compile time | generating an LFO/curve table at runtime on the audio thread |
| one `std::simd` body that targets both | two hand-written AVX-512 + NEON intrinsic paths |
| async closure `async || {}` or AFIT trait method | a boxed-future / lifetime workaround for a UI-to-Engine callback |
| GATs / const generics / `inline_const` to stay no-alloc | any allocation on the audio callback path |

## What does not live here

- Project-wide stack conventions, the DDD module-boundary rules, and the full
  RT-safety policy live in `AGENTS.md` and the rest of `docs/`, not here. This doc
  names primitives; the architecture rules constrain where they go.
- Adopting an unstabilized primitive past the version floor above. `Atomics.pause` is
  Stage 3 and explicitly in scope; anything below stable / Stage 3 is not.
- Using a primitive as cover for a behavior change. These are
  performance/ergonomics swaps; if behavior shifts, that is a different kind of work.
