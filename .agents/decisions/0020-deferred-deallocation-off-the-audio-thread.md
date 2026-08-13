---
type: architecture-decision-record
status: accepted
date: 2026-08-12
---

# 0020 — Retired allocations leave the audio thread over a return channel

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves `SPEC-session-launcher-engine` DG-001.

## Context

The launcher needs a lifetime primitive for clip data that the audio thread reads and a control
thread replaces. The source spec mandated `basedrop`, non-bindingly.

The same question already has a live answer in this repository, and a live violation.

## The rule is not in dispute

- CLAP, `thread-check.h`: the audio thread "should be as deterministic as possible to meet the audio
  interface's deadline (can be <1ms)", with the forbidden set given as "malloc() and free(),
  contended locks and mutexes, I/O, waiting, and so forth."
- VST3, Audio Processor Call Sequence: "may be called from real-time Audio Thread (must be lock-free
  and without memory allocation!)".
- Ross Bencina, *Real-time audio programming 101*: "Don't allocate or deallocate memory"; "Only
  perform dynamic allocation in a non-real-time thread where it isn't time-critical"; and on the
  mechanism, "best practice is to use lock-free FIFO queues to communicate commands and data".
- `AGENTS.md` already says the same thing for this project.

Deallocation is the half people forget. `free()` takes the allocator's lock exactly as `malloc()`
does.

## What we already ship

**The idiom exists and is proven under test.** `src-tauri/src/commands/crumbs.rs:103` does
`let _ = instance.recycle_tx.push((left, right));` over an `rtrb` SPSC producer, handing the retired
buffer back to a non-RT owner that performs the drop; `crumbs.rs:828` asserts the recycle. The same
`rtrb` channel pattern appears in `audio_bridge.rs` and `midi/rt_contract.rs`, and `triple_buffer`
carries RT-read snapshots in `midi/diagnostics.rs` and `daw-core/src/tuning.rs`.

`daw-engine` and `src-tauri` already depend on both crates. `daw-core` depends on `triple_buffer` but
not `rtrb`; using an `rtrb` return channel there would be a new crate-local dependency even though it
is already present in the workspace lockfile. `basedrop` is not in the tree.

**And there is a live violation.** `crates/daw-engine/src/scheduler.rs:144-149` handles
`RemoveEffect`/`RemovePlugin` with `self.effects.retain(|e| e.id != id)`. `ActiveEffect` owns
`PluginCore::Native(Box<dyn NativePlugin>)` and `Vec<Box<dyn MidiFx>>`, so `retain` frees heap
allocations on the audio thread. `RemoveMidiFx` does the same through `Vec::remove`. Filed as #1622.

## Decision

**Publish immutable generations by pointer swap; return retired generations to a non-RT owner over an
`rtrb` channel, which performs the drop.** No new dependency.

Size the return ring so that a full ring degrades to *keeping the current generation* rather than
dropping on the callback. A full ring must never become a reason to allocate or free in the audio
thread.

The launcher's implementation must fix `scheduler.rs:144-149` rather than route around it. Adding a
second correct path beside an existing incorrect one is how a codebase ends up with two idioms and
one bug.

## Alternatives rejected

**`basedrop`, as the source mandated.** Its documentation is written for exactly this problem —
"Memory-management tools for real-time audio and other latency-critical scenarios", with `Owned`
("deferred collection, analogous to `Box`"), `Shared` (analogous to `Arc`) and a `Collector`. That is
a genuine point in its favour. Against it: it would be a second lifetime model beside the recycle
channels already shipping, it does not by itself fix `scheduler.rs`, and its release history is thin —
0.1.0 through 0.1.2 across 2021, then nothing until 0.1.3 on 2025-10-29. Revisit if the launcher
turns out to need genuinely *shared* multi-reader clip data, which `triple_buffer`'s single-consumer
contract cannot express.

**`crossbeam-epoch`.** Provides the same capability generically — "you can defer the execution of an
arbitrary function until the global epoch is advanced" — and is far better maintained (0.9.20,
2026-07-06). Rejected as overkill: epoch pinning on the callback is a general-purpose reclamation
scheme for multi-producer multi-consumer structures, and this is one SPSC hand-off.

## Consequences

One RT-lifetime story across the launcher, Crumbs, MIDI diagnostics and tuning.

The non-RT drain must be scheduled reliably, or retired generations accumulate in the ring rather
than leaking — a bounded, observable failure rather than an unbounded one.

Worth noting for whoever adds verification: `assert_no_alloc` is the obvious tool for proving the
callback allocation-free, and it is unmaintained — last release 1.1.2 on 2021-08-03.

## Sources

- CLAP `thread-check.h`: https://github.com/free-audio/clap/blob/main/include/clap/ext/thread-check.h
- VST3 Audio Processor Call Sequence: https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Workflow+Diagrams/Audio+Processor+Call+Sequence.html
- Ross Bencina, *Real-time audio programming 101*: http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing
- `basedrop`: https://docs.rs/basedrop/latest/basedrop/ · `crossbeam-epoch`, `rtrb`, `triple_buffer` docs.rs
