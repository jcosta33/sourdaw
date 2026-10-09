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

This record extends 0051 and supersedes one of its clauses. 0051 says a processor that "faulted or
was disposed, and drops every later message"; a disposed processor now answers two, `releaseDisposedBanks` and a
repeated `dispose`, and still drops every other, and a faulted processor that is not disposed still
answers `dispose`. Every other clause of 0051 stands. The [Message contract](#message-contract)
below states every answer in full.

- **A disposed processor never frees its engine in `dispose`.** `dispose` still posts `disposed`
  at once, so the loader's "processor ended" contract is unchanged.
- **`retire_sample_bank` moves the sounding bank into the retired slot.** `LevainEngine::retire_sample_bank`
  silences the voices and moves the live zone map, PCM pool and legato store into the slot,
  leaving empty replacements. It frees nothing and allocates only the empty replacement pool's
  `Arc`, whatever the bank's size. It refuses (false) while the slot is occupied, so no bank is
  dropped by it, and when the sounding pool holds no PCM. It is only for an engine that will never
  render again.
- **The host paces the drain with `releaseDisposedBanks`.** A disposed processor, faulted or not,
  answers two messages: `releaseDisposedBanks`, and a repeated `dispose`, which it re-answers with
  `disposed`. It drops every other message, `beginSampleBank` and `releaseRetiredBank` included
  (a faulted processor that is disposed does not re-post its `error` for them). A live processor
  ignores `releaseDisposedBanks`. Each message does one bounded step and is answered by `disposedBanksReleased { done }`: release a step of the retired
  bank, else retire the sounding bank, else (both empty) free the engine, which then holds nothing
  bank-sized, and answer done. `LevainNode` sends the next message on each `done: false`.
- **A throwing step poisons the engine.** The step is caught, the processor answers done, and
  `free()` is never called on an engine that may be trapped. A processor with no engine answers done
  at once.
- **The processor stays reachable until done.** A module-level set holds a disposed processor that
  still has an engine, so the finalizer cannot free it in one call before the drain ends.
- **The node closes its port only when nothing more can arrive.** The drain ends on done (the
  engine freed, or poisoned by a throwing step and left unfreed) or when a live `AudioContext`
  becomes `closed`, which stops answering port messages and discards the worklet scope with it. A
  disposed processor posts no `error` during the drain, so the node's close on one is a defensive
  stop that no shipped processor path triggers. A completed `OfflineAudioContext` also reports
  `closed`, but its worklet scope still answers (measured in Chromium, 3 s after `startRendering`
  resolved), so it is not treated as gone and takes the drain.

The drain runs on the render thread, as 0051's release does, in steps bounded to a fraction of a
quantum. Teardown of a very large bank takes proportionally many messages.

## Message contract

What `LevainProcessor` posts for each message it receives, by state. This table is the one statement
of the contract; the processor's header, `AudioEngine`'s guidance and the loader's comments defer to it
or restate only the rows they need. "Silent" means the message is dropped and nothing is posted.
"Faulted" means a throw from `process()` or a message handler set `_faulted`; the processor then
posted `error` once. A faulted processor that has not been disposed still handles `dispose`.

| Message                                                                                          | Live                                                                                                                                         | Faulted, not disposed                                | Disposed, not faulted                              | Faulted, then disposed                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `init`                                                                                           | `ready` the first time, once the engine exists; silent after                                                                                 | silent                                               | silent                                             | silent                                             |
| `noteOn`, `noteOff`, `noteExpression`, `allNotesOff`, `param`, `cc`, `discardStoredCc`, `bypass` | silent (queued or applied)                                                                                                                   | silent                                               | silent                                             | silent                                             |
| `beginSampleBank`                                                                                | `sampleBankUploadDecision { loadToken, uploadRequired }`                                                                                     | `error { message }`, the original fault posted again | silent                                             | silent                                             |
| `abortSampleBank`, `addZone`, `addLegatoTransition`                                              | silent for a stale or foreign `loadToken`; an abort of the current load posts `sampleBankError { loadToken, message }`                       | silent                                               | silent                                             | silent                                             |
| `beginSample`, `sealSample`                                                                      | silent for a stale or foreign `loadToken`, and for a follower or ready load, which uploads nothing; a refusal posts `sampleBankError`        | silent                                               | silent                                             | silent                                             |
| `sampleChunk`                                                                                    | `sampleChunkWritten { loadToken, sampleId }` once the chunk is written; a refusal posts `sampleBankError` instead; silent for a stale or foreign `loadToken`, or a follower or ready load | silent                                               | silent                                             | silent                                             |
| `buildZoneMap`                                                                                   | `sampleBankLoaded { loadToken }` when the commit lands (a follower posts it when the owner's bank publishes); silent for a stale `loadToken` | silent                                               | silent                                             | silent                                             |
| `releaseRetiredBank`                                                                             | `retiredBankReleased { loadToken, done }`, done at once for a token that retired nothing                                                     | `error { message }`, the original fault posted again | silent                                             | silent                                             |
| `releaseDisposedBanks`                                                                           | silent                                                                                                                                       | silent                                               | `disposedBanksReleased { done }`, one bounded step | `disposedBanksReleased { done }`, one bounded step |
| `dispose`                                                                                        | `disposed`; the processor is then disposed                                                                                                   | `disposed`; the processor is then disposed           | `disposed` again                                   | `disposed` again                                   |

Where the posts come from, beyond the table:

- **A throwing handler.** A throw inside a live handler posts `sampleBankError { loadToken, message }`
  when a bank load is in flight (the load rejects, the processor stays live) and otherwise faults the
  processor with `error { message }`. A throw in `process()` faults it.
- **A sample upload.** `beginSample` reserves the sample's whole storage in the engine, `sampleChunk`
  copies at most one chunk (`LEVAIN_SAMPLE_CHUNK_FLOATS`) into it, and `sealSample` publishes it. The
  engine offers a write window of at most one chunk, so the worklet refuses, before writing a byte, a
  chunk that does not fit, belongs to another sample or runs past the sample; a sealed short sample
  and a refused begin throw like any staging message, so the load rejects with `sampleBankError`. A
  sample still open when the load aborts moves into the retired slot with the staged bank, and the
  first `releaseRetiredBank` step frees it. The loader paces itself on `sampleChunkWritten`: it leaves at
  most `LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT` chunks unacknowledged, so the worklet's queue never holds a long
  run of them to drain between two quanta, and it stops waiting at once on an abort, on a
  `sampleBankError` for its load, or when the processor ends (`error`, `disposed`).
- **A processor that faulted before `init` completed** answers like the faulted column: it re-posts
  `error` for `beginSampleBank` and `releaseRetiredBank`, buffers the rest unanswered, and a repeated
  `init` retries the engine's creation.
- **A message before `init`** is buffered, not answered, and replayed once the engine exists; `dispose`
  clears the buffer.
- **The disposal drain's answers.** `disposedBanksReleased { done: false }` follows a step that released
  part of the retired bank or retired the sounding bank. `done: true` follows the step that freed the
  emptied engine, and every request after it. A step that throws logs the error, poisons the engine
  and answers `done: true` without freeing it; so does every later request. A disposed processor with
  no engine answers `done: true` at once.
- **Disposal itself** posts `disposed` even when releasing held notes or aborting the staged load
  throws; it frees nothing. The processor then returns false from `process()`.

## Consequences

- Every route that destroys a Levain node reaches `destroy()` in `LevainNode`, so the drain covers
  device removal, track and bus removal, load abort and timeout, and fault recovery without any change
  to the device registry. A live context's close needs no drain: it stops answering and its scope is
  discarded.
- An engine that throws mid-drain is left for the finalizer, as before this record; the drain
  narrows the common case rather than claiming a bound for a faulted wasm instance.
- Offline renders destroy their Levain nodes through the same `destroy()` (via
  `destroyOfflineDeviceStrategies`) after rendering, when the offline context already reports
  `closed` yet still answers, so they take the same paced drain. Any context other than a closed
  live `AudioContext`, a suspended one included, posts `dispose` and drains; a closed live one closes
  the port at once.
- The finalizer's thread is not established by this record; the design does not depend on it.
