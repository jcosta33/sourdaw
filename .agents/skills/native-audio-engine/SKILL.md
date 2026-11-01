---
name: native-audio-engine
description: >-
    Keep native Rust real-time audio safe and sample-accurate: the daw-engine
    render callback, the graph command ring, the offline renderer, and the
    hosted-plugin process path. ALWAYS apply when editing `crates/daw-engine`,
    the audio or host-bridge code in `crates/sourdaw-native`, or the processing
    side of `crates/daw-plugin-host` — even if it looks like a one-line change to
    a command arm, a render loop, or a test guard. Skip browser and worklet audio
    (web-audio-engine), built-in device DSP authoring (device-authoring), and
    plugin scanning or editor windows (plugin-hosting).
---

## Purpose

The native engine renders on an OS audio callback with a hard deadline. Every structure the callback touches is built on the control thread, crosses a lock-free ring, and leaves the same way. This skill covers what may run on that callback, how the graph changes under it, how its guards are written, and where its timing contract lives. The crate `AGENTS.md` files hold the full invariants; this is the working checklist.

## Core rules

### 1. The callback allocates, frees, locks, blocks and logs nothing

The RT path is `DeviceRenderer::render_with_timing` in `crates/daw-engine/src/audio_thread.rs`, which runs `AudioScheduler::update_graph` then `AudioScheduler::process_block`, and every `NativePlugin` method (`plugin_slot.rs`) they reach, including `HostedPluginSlot` and `CrumbsPluginSlot` in `crates/sourdaw-native/src/host/native_bridge.rs`. On it: no heap allocation or free, no `Mutex::lock`, no sleep or wait, no file, network or IPC call, no `eprintln!` or logging, no host seam from `events.rs` or `host/`, no serialization. Scratch is reserved at construction for the largest block the callback may be handed (`MAX_CALLBACK_FRAMES`).

**Why:** any of these can take longer than a device period, and a missed deadline is an audible dropout.

**Enforced by:** `assert_no_alloc` guards over daw-engine's `DeviceRenderer` render, `AudioScheduler::update_graph` and `process_block` (`apply_alloc_guards` in `scheduler.rs`, `compensation_render_alloc_guards` in `audio_thread.rs`), `TimelineGraph::render` (`timeline.rs`), the capture ring (`capture.rs`) and retrospective writer (`retrospective.rs`), and over `CrumbsPluginSlot` (`take_callback_transitions_never_allocate_or_free` in `native_bridge.rs`, `callback_lifecycle_probe` in `sourdaw-native/src/commands/crumbs.rs`). Review only for allocation in `HostedPluginSlot::process_audio` and `process_with_events`, which no guard drives, and in daw-plugin-host, which has no guard; review only for locks, blocking, syscalls and logging everywhere — no lint catches them.

### 2. Change the graph only through `GraphCommand` on the command ring

The control side is `EngineHandle` (`crates/daw-engine/src/lib.rs`). Its typed methods push one loose command each. A change that spans commands goes through `EngineHandle::send_graph_batch` (or `send_graph_batch_with_headroom`), which pushes a `GraphCommand::BeginBatch { commands }` fence before the body; `update_graph` defers a fenced batch until the whole body is visible and the retirement ring can take one retirement per command, then applies it between two blocks. A batch larger than the ring reallocates the channel control-side and hands the new ends over in `GraphCommand::SwapCommandChannel`. Admission runs before the first push, so `GraphBatchError::Refused` means nothing reached the engine.

**Why:** rtrb publishes per element; a multi-command change sent loose can render one block half-applied.

**Enforced by:** `a_fenced_batch_with_a_split_visible_prefix_renders_the_pre_batch_graph` and `retirement_backpressure_defers_a_fenced_batch_whole_at_its_boundary` (`scheduler.rs`), `a_batch_larger_than_the_command_ring_applies_whole_against_an_idle_engine` (`lib.rs`); review only for a caller that sends a dependent pair loose.

### 3. Build on the control thread, retire off the callback

Every owning payload — instance, delay line, clip buffer, note batch, tempo map — arrives built inside its command. Whatever the callback gives up leaves as `RetiredGraphObjects` over the retirement ring to the reclaimer thread ([ADR 0020](../../decisions/0020-deferred-deallocation-off-the-audio-thread.md)). A new `GraphCommand` variant must state its effect in `GraphCommand::effect_table_delta` and `GraphCommand::dirties_compensation`. Removed hosted runtimes go to `AppState::retired_engine_plugins` and leave only through `sweep_retired_engine_plugins`, once the scheduler has released its own `Arc`.

**Why:** a free is as unbounded as an allocation, and a plugin destructor runs third-party code.

**Enforced by:** the `apply_alloc_guards` module in `scheduler.rs` (the interceptor aborts on dealloc too), `a_removed_clip_and_a_removed_bus_are_retired_rather_than_dropped_on_the_callback` (`scheduler.rs`), `taking_released_runtimes_keeps_one_the_scheduler_still_references` (`sourdaw-native/src/state.rs`); both classifiers are exhaustive matches, so an unclassified variant fails to compile.

### 4. Fixed capacity: refuse and count, never grow

Callback tables are reserved once (`EFFECT_TABLE_CAPACITY` and `CRUMBS_CAPTURE_RESERVE` in `scheduler.rs`, `MAX_TIMELINE_TRACKS` and `MAX_TIMELINE_BUSES` in `timeline.rs`). Past capacity the callback refuses, retires the payload, and counts it in `TimelineRtDiagnosticsSnapshot` or `ActiveMidiRtDiagnosticsSnapshot`. The control side admits first (`EngineHandle::ensure_effect_table_headroom`, batch admission) so the caller receives an `Err` the callback cannot return.

**Why:** a push past a reserve reallocates inside the deadline, and a silent drop plays a project the user did not make.

**Enforced by:** `a_track_past_the_graphs_capacity_is_refused_and_retired_rather_than_grown` and `an_over_capacity_batch_is_refused_whole_and_counted` (`scheduler.rs`), `a_graph_batch_is_admitted_against_the_whole_effect_table` (`lib.rs`).

### 5. Never wait on a hosted plugin from the callback

`SharedHostedPlugin::with_process` claims the plugin by atomic compare-exchange and skips the block when the control path holds it, keeping undelivered MIDI for the next block. A hosted instance runs inline, once per block, in the chain that holds it; no command relays its audio across a process boundary. Only processing-state transitions run on the audio thread, through `ProcessingGate`; VST3 `setActive`, `setupProcessing`, `initialize` and `terminate` stay on the control path.

**Why:** the control path runs unbounded third-party code (`open_gui`, `set_state`), and a second cadence breaks the one clock.

**Enforced by:** `the_audio_path_does_not_wait_for_a_control_path_barrier` and `a_note_off_queued_while_control_owns_the_seam_is_delivered_once_access_is_released` (`native_bridge.rs`), `both_processing_transitions_run_on_the_thread_that_calls_process` (`daw-plugin-host/src/clap_wrapper.rs`), `the_loader_activates_but_never_enters_the_processing_state` (`daw-plugin-host/src/vst3_wrapper/tests.rs`).

### 6. Drive the engine audible, then guard it

Put allocation guards in a `#[cfg(debug_assertions)]` module: `disable_release` is on by default, so in release `assert_no_alloc(f)` is `f()`. The binary needs `#[global_allocator] static ALLOCATOR: AllocDisabler = AllocDisabler;` once; the daw-engine library tests get it from `apply_alloc_guards`, and a new file under `tests/` is its own binary and must install its own. Build instances, rings and buffers outside the closure; wrap only callback work (`renderer.render`, `update_graph`, `process_block`, a `NativePlugin` method). First drive a configured, audibly active state — transport playing, device on a chain, notes due, a parameter written mid-run — then assert non-silence, as `a_hosted_fermenter_renders_due_notes_without_allocating_on_the_callback` (`audio_thread.rs`) and `crates/daw-dsp/tests/device_process_rt.rs` do. Guarding `set_param` is not guarding `process`.

**Why:** most bodies early-return at their defaults, so a guard around an idle instance executes no DSP and passes.

**Enforced by:** review only; probe by adding one `Vec::with_capacity(1)` inside the wrapped path — the run must abort with `SIGABRT` and `memory allocation of N bytes failed`, not fail normally.

### 7. Time is absolute frames, and an event lands on its sample

`AudioScheduler::playhead_frames` is the absolute frame of the next block's first sample and advances only while playing. Seconds become frames once, at the rate the stream opened at (`EngineHandle` converts against its own; `seconds_to_frames` in `sourdaw-native/src/commands/graph.rs`). A note sent with `EngineHandle::schedule_midi_notes` reaches the instrument on the sample that renders its frame; `send_midi_note` is live and lands at the next block head; a note behind the playhead is stored and counted late, never fired out of order. A device is handed events in non-decreasing time. Stop, locate, loop wrap and clear release every scheduled note the store has sounded.

**Why:** quantising to the block puts a note up to a buffer away from where it was written.

**Enforced by:** `a_scheduled_note_reaches_the_instrument_on_its_timeline_frame_across_a_block_boundary`, `a_note_behind_the_playhead_is_stored_and_counted_late`, `notes_scheduled_in_two_interleaving_batches_reach_the_instrument_in_frame_order` and `stopping_the_transport_releases_every_note_the_store_has_sounded` (`scheduler.rs`).

### 8. Offline renders through the same scheduler

`OfflineRenderer` (`offline.rs`) is the same `AudioScheduler` over the same command ring, drained then rendered in `OFFLINE_BLOCK_FRAMES` blocks, with no device or clock. Never add an offline branch or a second renderer: behaviour must not depend on block size or phase, because live callbacks run on the device's period. Size its ring to the whole batch, as `render_offline_ops` in `sourdaw-native/src/commands/graph.rs` does, so the graph is never rendered half-built. Hosted plugins are not bound offline.

**Why:** offline is the null-test oracle for live playback; one implementation means a difference is a transport defect.

**Enforced by:** `the_same_batch_renders_bit_identical_output_twice` (`offline.rs`) for determinism; `a_clip_through_a_gain_renders_the_expected_samples` and `a_render_spanning_many_blocks_places_the_clip_on_its_absolute_frames` (`offline.rs`) for absolute frame placement across multiple blocks; `a_fermenter_note_renders_the_same_samples_live_and_offline` (`scheduler.rs`) is the only full-array comparison across block edges (128- against 512-frame blocks), for that instrument. Exact samples at a block edge for anything else is review only.

### 9. Teardown order is field order

The stream stops and drains before DSP bodies and plugin runtimes drop. Field order is drop order in `AppState`, `NativeSingletons` and `OfflineRenderer`; reordering fields reorders teardown. A shell's quit path calls `shutdown::shutdown` and never reassembles its steps.

**Why:** a runtime dropped while the callback can still reach it is a use-after-free on the audio thread.

**Enforced by:** review only for field order; `shutdown_closes_editors_before_it_sweeps_the_retirement_vec` and its siblings in `sourdaw-native/src/shutdown.rs` pin the cascade.

### 10. The engine knows no shell; the shell holds no behaviour

`daw-engine` names no shell or IPC type. `sourdaw-native` bodies take and return plain owned values and reach the host through the traits in `events.rs` and `host/`; `electron/` owns IPC and its wrapper only unwraps and calls a body (see `desktop-platform`). Telemetry leaves the callback as lock-free snapshots (`MeterReader`, `TransportPositionReader`, `GraphProgressReader`) read control-side and relayed. A payload change updates the hand-written mirror types in the owning module's `repositories/` in the same change.

**Why:** a shell type in a body ties the engine to one transport, and no binding generator catches a drifted mirror.

**Enforced by:** `electron/__tests__/commands.spec.ts` for exposed commands and positional argument order; review only for shell independence and DTO field parity.

### 11. Verify focused, in debug

```bash
pnpm guard --profile focused --show-output -- pnpm cargo:test --package <crate> <filter>
pnpm cargo:fmt --package <crate>
```

Never add `--release`: it compiles every allocation guard away. Read the `running N tests` line; a filter that matches nothing exits 0 (`test-design` rule 10). Workspace tests, `cargo fmt --all --check` and clippy run in PR CI.

**Why:** a green run that executed no guard proves nothing.

**Enforced by:** `scripts/health-gates-rust.sh` and the `native-macos` job in `.github/workflows/validation.yml` (PR CI, debug profile).

## References

- [crates/daw-engine/AGENTS.md](../../../crates/daw-engine/AGENTS.md) — RT invariants, note timing, plugin delay compensation.
- [crates/sourdaw-native/AGENTS.md](../../../crates/sourdaw-native/AGENTS.md) — shell independence, hosted-plugin RT rules, drop order.
- [crates/daw-plugin-host/AGENTS.md](../../../crates/daw-plugin-host/AGENTS.md) — thread-affine lifecycle calls, retirement queue.
- [crates/daw-dsp/AGENTS.md](../../../crates/daw-dsp/AGENTS.md) — how the RT guards are written and what they cannot see.
- [docs/architecture/02-rust-backend.md](../../../docs/architecture/02-rust-backend.md) — crate topology and the RT boundary.
- [ADR 0020](../../decisions/0020-deferred-deallocation-off-the-audio-thread.md) — deferred deallocation off the audio thread.
