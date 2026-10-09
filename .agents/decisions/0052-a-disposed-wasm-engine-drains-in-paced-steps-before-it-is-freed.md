---
type: adr
id: 0052
title: A disposed wasm Levain engine drains its banks in paced steps before it is freed
status: accepted
date: 2026-10-09
owner: The Sourdaw team
sources:
    - .agents/decisions/0051-wasm-bank-commit-retires-instead-of-releasing-off-thread.md
    - crates/daw-dsp/src/levain/engine.rs
    - crates/daw-dsp/tests/levain_bank_retirement.rs
    - src/modules/AudioEngine/services/levainProcessor.ts
    - src/modules/AudioEngine/engine/LevainNode.ts
    - https://github.com/jcosta33/sourdaw/issues/5125
---

# 0052 - A disposed wasm Levain engine drains its banks in paced steps before it is freed

## Context

ADR 0051 moved the free of a displaced or aborted bank out of the commit and into paced
`releaseRetiredBank` messages. It left one path unpaced: a disposed processor. `dispose` retired only
the staged bank, then the processor dropped every message and returned false from `process()`, so
nothing ever released the live bank. When the engine was collected, wasm-bindgen's finalizer freed the
engine, and with it the whole zone map, PCM pool and legato store, in one call on the worklet thread.
That is the unbounded, bank-sized free ADR 0051 removed from the commit, reached through device
removal, track deletion and every other route that destroys a Levain node.

## Decision

This record extends 0051; it changes none of its clauses.

- **A disposed processor never frees its engine in `dispose`.** `dispose` still posts `disposed`
  at once, so the loader's "processor ended" contract is unchanged.
- **`retire_sample_bank` moves the sounding bank into the retired slot.** `LevainEngine::retire_sample_bank`
  silences the voices and moves the live zone map, PCM pool and legato store into the slot,
  leaving empty replacements. It frees nothing and allocates only the empty replacement pool's
  `Arc`, whatever the bank's size. It refuses (false) while the slot is occupied, so no bank is
  dropped by it, and when the sounding pool holds no PCM. It is only for an engine that will never
  render again.
- **The host paces the drain with `releaseDisposedBanks`.** It is the one message a disposed
  processor, faulted or not, still honours; a live processor ignores it. Each message does one
  bounded step and is answered by `disposedBanksReleased { done }`: release a step of the retired
  bank, else retire the sounding bank, else (both empty) free the engine, which then holds nothing
  bank-sized, and answer done. `LevainNode` sends the next message on each `done: false`.
- **A throwing step poisons the engine.** The step is caught, the processor answers done, and
  `free()` is never called on an engine that may be trapped. A processor with no engine answers done
  at once.
- **The processor stays reachable until done.** A module-level set holds a disposed processor that
  still has an engine, so the finalizer cannot free it in one call before the drain ends.
- **The node closes its port only when nothing more can arrive.** On done, on an `error` posted
  during the drain, or when the context's state becomes `closed`, which discards the worklet scope
  and its memory with it.

The drain runs on the render thread, as 0051's release does, in steps bounded to a fraction of a
quantum. Teardown of a very large bank takes proportionally many messages.

## Consequences

- Every route that destroys a Levain node reaches `destroy()` in `LevainNode`, so the drain covers
  device removal, track and bus removal, load abort and timeout, and fault recovery without any change
  to the device registry. A context close needs no drain: its scope is discarded.
- An engine that throws mid-drain is left for the finalizer, as before this record; the drain
  narrows the common case rather than claiming a bound for a faulted wasm instance.
- Offline renders destroy their Levain nodes through the same `destroy()` (via
  `destroyOfflineDeviceStrategies`), so they take the same paced drain; a context already closed at
  destroy closes the port at once.
- The finalizer's thread is not established by this record; the design does not depend on it.
