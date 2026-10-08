---
type: adr
id: 0051
title: A wasm bank commit allocates and frees nothing; the displaced bank is retired and freed by a paced message
status: accepted
date: 2026-10-08
owner: The Sourdaw team
sources:
    - .agents/decisions/0020-deferred-deallocation-off-the-audio-thread.md
    - crates/daw-dsp/src/levain/engine.rs
    - crates/daw-dsp/tests/device_process_rt.rs
    - crates/daw-dsp/tests/levain_bank_retirement.rs
    - src/modules/AudioEngine/services/levainProcessor.ts
    - src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts
    - https://github.com/jcosta33/sourdaw/issues/4809
---

# 0051 - A wasm bank commit allocates and frees nothing; the displaced bank is retired and freed by a paced message

## Context

ADR 0020 sends retired allocations off the audio thread over an `rtrb` return channel to a non-RT
owner that drops them. That mechanism needs a second thread that can free the memory.

The browser Levain worklet cannot offer one. `daw-dsp` is built by `wasm-pack` with no atomics or
shared-memory flags (`package.json` `wasm:dsp`), so its linear memory belongs to the one wasm
instance in the `AudioWorkletGlobalScope`, and wasm-bindgen's glue makes that instance a realm
singleton. Only code running in that instance can free what it allocated, and that code runs on the
render thread. A Worker's instance has separate memory and cannot free the worklet's. A shared-memory
build would change every device in the package and put an allocator lock on the audio thread, which
ADR 0020 forbids.

Until this record, `LevainEngine::commit_sample_bank` dropped the previous zone map, the previous
`Arc<SamplePool>` and the previous legato store, and pushed each staged transition into a fresh
`Vec`, all inside a port-message handler between render quanta (#4809). An `assert_no_alloc` probe
aborted on the 48-byte transition allocation.

## Decision

A wasm bank release off the audio thread is not possible, and this record does not pretend
otherwise. The replacement contract has two parts:

- **The commit allocates and frees nothing.** It swaps the zone map, the PCM pool and the legato
  transition store with the staged bank's, and moves the displaced storage, with the staged bank's
  leftover instrument id, into a single retired slot. A commit that finds the slot occupied returns
  false and leaves the bank staged.
- **A paced message frees the retired bank.** `release_retired_bank(max_entries)` frees at most
  `max_entries` PCM entries per call and reports when the slot is empty. A pool a sibling instance
  still shares is only released by decrementing its count. The host sends one
  `releaseRetiredBank` message per step, after `sampleBankLoaded`, and repeats it while the worklet
  answers that more remains. `begin_sample_bank` also frees whatever is left, so the slot is empty by
  the time the next bank commits.

Release still runs on the render thread. What changes is where: never inside the commit and never in
`process()`, in steps bounded to a fraction of a quantum (freeing 6,000 samples in one call measured
about 2.3 ms on the shipped wasm under Node, against a 2.67 ms quantum at 48 kHz).

## Consequences

- Zone-map construction (`ZoneMap::build_lut`) and PCM copy-in remain staging messages on the render
  thread. Moving them to a Worker, and splitting large samples into chunks, are separate follow-ups.
- The retired slot holds one bank. Peak residency is unchanged: the displaced bank is freed after the
  commit instead of during it.
- `device_process_rt.rs` guards the commit with `assert_no_alloc`, which aborts on a free as well as an
  allocation; `levain_bank_retirement.rs` counts allocations to show the frees moved to the release.
- The native host is unaffected: it builds and commits each instance on a control thread before the
  audio thread sees it, and the retired bank is freed there or with the instance.
- If wasm threads with a lock-free allocator ever ship, ADR 0020's return channel can replace the
  slot; this record then yields to it.
