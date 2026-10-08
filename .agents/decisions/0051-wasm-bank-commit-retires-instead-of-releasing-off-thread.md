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
- **The abort allocates and frees nothing either.** `abort_sample_bank` moves the whole staged bank
  (zone map, PCM pool, legato store, instrument id) into the same slot and returns whether it
  retired one. Dropping it there would free a whole bank, or the last reference to a shared pool, in
  one message on the render thread, a cost that scales with the bank. The API cannot reach an abort
  with the slot occupied (begin empties it, a commit consumes the staged bank); if a host gets there
  anyway, the abort frees the older bank in that call, as begin does, and retires the staged one.
- **A paced message frees the retired bank.** `release_retired_bank(max_entries)` frees at most
  `max_entries` PCM entries per call and reports when the slot is empty. A pool a sibling instance
  still shares is only released by decrementing its count. The host sends one
  `releaseRetiredBank` message per step and repeats it while the worklet answers that more remains:
  after `sampleBankLoaded` for a load that committed, and after the `abortSampleBank` it posted (or
  after the worklet's own `sampleBankError`) for one that failed once its begin was posted. The
  release is fenced by the load's token, and the worklet answers one for a token that retired
  nothing as done. Every load registers with its port before it posts `beginSampleBank`, and the
  next load's begin waits until every earlier load on that port is over: the end of the release
  loop for every load whose begin was posted, or, for a load that never posted one, the end of the
  loads before it. Begin then finds the slot empty and frees nothing. If the processor ended (it
  faulted or was disposed, and drops every later message), the release loop stops at once, and the
  waiting load rejects with the same "processor ended" error the handshake uses and posts nothing.
- **Two bounded costs stay on the render thread, accepted.** `attach_sample_bank` frees an empty
  placeholder pool (one small allocation, since followers and ready roles never upload PCM) and
  refuses once the staged bank holds PCM, so a misused call cannot drop staged samples.
  `publish_sample_bank` allocates its registry key (a few dozen bytes). Both are bounded and do not
  scale with the bank. Moving them off the message handler waits for `ZoneMap::build_lut` to leave
  the render thread (#5080), which would let the key be preallocated at begin.
- **`begin_sample_bank` frees a leftover bank in one call.** That is only a safety net for a host
  that does not wait for the loop, such as one that supersedes a load before the release finishes
  and then talks to the engine directly. The call is unbounded: it frees the whole bank. The loader
  does not reach it.

Release still runs on the render thread. What changes is where: not inside the commit, not in
`process()`, and, through the loader, in steps bounded to a fraction of a quantum (freeing 6,000
samples in one call measured about 2.3 ms on the shipped wasm under Node, against a 2.67 ms quantum
at 48 kHz). The one unbounded free is the safety net above.

## Consequences

- Zone-map construction (`ZoneMap::build_lut`) and PCM copy-in remain staging messages on the render
  thread. Moving them to a Worker, and splitting large samples into chunks, are separate follow-ups.
- The retired slot holds one bank. Peak residency is unchanged: the displaced bank is freed after the
  commit instead of during it.
- `device_process_rt.rs` guards the commit and the abort with `assert_no_alloc`, which aborts on a free
  as well as an allocation; `levain_bank_retirement.rs` counts allocations to show the frees moved to
  the release.
- A failed load now delays the next load on its port by one round trip plus a paced release, where it
  used to release the port at once.
- The native host is unaffected: it builds and commits each instance on a control thread before the
  audio thread sees it, and the retired bank is freed there or with the instance.
- If wasm threads with a lock-free allocator ever ship, ADR 0020's return channel can replace the
  slot; this record then yields to it.
