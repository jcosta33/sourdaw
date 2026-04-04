# Rust architecture for a Tauri v2 DAW backend

A professional DAW built with Tauri v2 should use a **Cargo workspace with 4–6 crates**, keeping domain logic in Tauri-free library crates and treating `src-tauri` as a thin bridge layer. This mirrors your TypeScript DDD structure while respecting Rust idioms and the hard boundary between real-time and non-real-time code. The architecture draws from patterns proven in Meadowlark, NIH-plug, and Firewheel — the three most instructive Rust audio projects — and adapts them for Tauri v2's command, event, and Channel APIs.

The core principle: **the audio engine knows nothing about Tauri, and Tauri knows nothing about DSP**. A bridge layer translates between them, acting as the anti-corruption layer your DDD architecture demands.

---

## The Cargo workspace should have 5 crates, not 15

Tauri v2 explicitly supports Cargo workspaces — `tauri dev` auto-watches all workspace members and rebuilds on changes. The Tauri project itself uses 14+ crates internally. For a DAW, the sweet spot is **5 focused crates** that map to your domain boundaries without the maintenance overhead Meadowlark's developer warned about after managing 15+ separate repositories.

```
my-daw/
├── Cargo.toml                    # Workspace root
├── crates/
│   ├── daw-core/                 # Domain models, newtypes, shared types
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── ids.rs            # TrackId, ClipId, PluginId, BusId
│   │       ├── units.rs          # Beats, Decibels, SampleRate, Hertz
│   │       ├── project.rs        # ProjectState, TrackState, ClipState
│   │       ├── transport.rs      # TransportState, PlaybackPosition
│   │       ├── routing.rs        # RoutingGraph, Connection
│   │       ├── automation.rs     # AutomationLane, AutomationPoint
│   │       ├── midi.rs           # MidiEvent, MidiMessage types
│   │       └── events.rs         # Cross-domain event enum
│   ├── daw-engine/               # Audio engine, RT processing, lock-free comms
│   │   └── src/
│   │       ├── lib.rs            # EngineHandle (non-RT API)
│   │       ├── audio_thread.rs   # RT callback, schedule executor
│   │       ├── graph.rs          # Graph topology, compiled schedule
│   │       ├── processors/       # DSP node implementations
│   │       ├── commands.rs       # EngineCommand enum (ring buffer messages)
│   │       ├── meters.rs         # MeterData, peak tracking
│   │       └── disk_stream.rs    # creek-based disk streaming
│   ├── daw-dsp/                  # Pure DSP algorithms (no I/O, no state)
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── filters.rs
│   │       ├── dynamics.rs
│   │       ├── delay.rs
│   │       ├── reverb.rs
│   │       ├── resampler.rs      # rubato wrapper
│   │       └── waveform.rs       # Peak generation for UI
│   ├── daw-plugin-host/          # CLAP/VST3 hosting via clack-host
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── clap_host.rs
│   │       ├── scanner.rs        # Plugin discovery
│   │       └── instance.rs       # Plugin instance lifecycle
│   └── daw-io/                   # File I/O, audio codecs, MIDI I/O, dictation
│       └── src/
│           ├── lib.rs
│           ├── project_file.rs   # Save/load project files
│           ├── audio_decode.rs   # symphonia decoding
│           ├── audio_encode.rs   # WAV/FLAC/MP3 export
│           ├── midi_io.rs        # midir integration
│           └── dictation.rs      # whisper-rs + mic capture
├── src-tauri/                    # Thin Tauri bridge (commands, events, state wiring)
│   ├── Cargo.toml                # Depends on all daw-* crates via path
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── build.rs
│   └── src/
│       ├── main.rs               # #![cfg_attr(...)] standard Tauri main
│       ├── lib.rs                # Builder setup, tauri-specta, state registration
│       ├── state.rs              # AppState struct, type aliases
│       ├── error.rs              # ApiError with manual Serialize
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── project.rs        # open_project, save_project, export_audio
│       │   ├── transport.rs      # play, pause, stop, seek, set_tempo
│       │   ├── tracks.rs         # create_track, delete_track, set_volume
│       │   ├── arrangement.rs    # add_clip, move_clip, split_clip
│       │   ├── routing.rs        # connect, disconnect, add_bus
│       │   ├── plugins.rs        # scan_plugins, add_plugin, remove_plugin
│       │   ├── midi.rs           # list_midi_devices, select_device
│       │   ├── automation.rs     # add_point, delete_point, set_mode
│       │   └── dictation.rs      # start_dictation, stop_dictation
│       └── relay.rs              # UI relay: drains meters, emits via Channel
├── src/                          # TypeScript frontend
├── package.json
└── tsconfig.json
```

The root `Cargo.toml` declares the workspace and shared dependency versions:

```toml
[workspace]
members = ["src-tauri", "crates/*"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
specta = { version = "2", features = ["derive"] }
thiserror = "2"
rtrb = "0.3"
cpal = { version = "0.17", features = ["audio_thread_priority"] }
```

**Why this split and not more crates?** Meadowlark's developer explicitly warned that managing many small repositories became a maintenance nightmare. NIH-plug succeeds with a single primary crate plus focused satellite crates. The 5-crate split here maps to genuinely different compilation units and dependency trees: `daw-core` has zero heavy dependencies (just serde + specta), `daw-dsp` is pure math, `daw-engine` pulls in cpal/rtrb, and `daw-io` brings symphonia/midir/whisper-rs. Each crate compiles independently, and changes to DSP algorithms don't trigger recompilation of the Tauri bridge.

---

## Mirroring DDD domains through Rust's module and visibility system

Your TypeScript frontend has 8 domain modules. In Rust, **each domain becomes a module within the appropriate crate**, not its own crate. The domain boundaries are enforced through Rust's visibility system — `pub`, `pub(crate)`, and `pub(super)` — rather than crate boundaries.

The **modern Rust convention** (2018 edition onward) favors the file-per-module style over `mod.rs`. A module named `transport` lives at `transport.rs` with a sibling `transport/` directory for sub-modules, rather than `transport/mod.rs`. This gives every file a unique name in editor tabs.

Contract-based boundaries map directly to Rust visibility:

```rust
// In daw-core/src/lib.rs — the public API surface
pub mod ids;           // TrackId, ClipId — fully public
pub mod units;         // Beats, Decibels — fully public
pub mod project;       // ProjectState — public models
pub mod transport;     // TransportState — public models

// Re-exports for convenience
pub use ids::*;
pub use units::*;
```

```rust
// In daw-engine/src/lib.rs — expose only EngineHandle
mod audio_thread;       // Private — no one outside touches the RT thread
mod graph;              // Private — internal graph representation
mod commands;           // Private — internal command enum
pub mod processors;     // pub for extensibility (custom DSP nodes)
mod meters;             // Private

pub struct EngineHandle { /* ... */ }  // The ONLY public entry point

impl EngineHandle {
    pub fn new(config: EngineConfig) -> Self { /* ... */ }
    pub fn play(&self) { /* ... */ }
    pub fn stop(&self) { /* ... */ }
    pub fn set_track_volume(&self, track: TrackId, db: Decibels) { /* ... */ }
    pub fn get_meter_data(&self) -> Vec<MeterData> { /* ... */ }
}
```

This is the Rust equivalent of your TypeScript contract-based boundaries. `EngineHandle` is the **only** public interface to the audio engine. The audio thread, graph internals, and command protocol are private implementation details. Other crates (including `src-tauri`) interact exclusively through `EngineHandle`'s methods — exactly like a use-case/command entry point in DDD.

For **cross-module communication**, use a domain event enum in `daw-core` that all crates can reference, combined with `tokio::sync::broadcast` for non-real-time events:

```rust
// daw-core/src/events.rs
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum DomainEvent {
    TrackCreated { track_id: TrackId, name: String },
    TrackDeleted { track_id: TrackId },
    PlaybackStarted { position: Beats },
    PlaybackStopped,
    ProjectLoaded { name: String },
    MeterUpdate { levels: Vec<MeterData> },
}
```

---

## Newtypes and shared models anchor the entire type system

The `daw-core` crate is the foundation. It contains **only** data types — no behavior, no I/O, no heavy dependencies. Every other crate depends on it. This mirrors your TypeScript pattern of plain data models.

```rust
// daw-core/src/ids.rs
use serde::{Serialize, Deserialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct TrackId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct ClipId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct PluginId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct BusId(pub String);
```

```rust
// daw-core/src/units.rs
use derive_more::{From, Into, Add, Sub, Mul};

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[derive(From, Into, Add, Sub, Mul)]
#[serde(transparent)]
pub struct Beats(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[derive(From, Into)]
#[serde(transparent)]
pub struct Decibels(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct SampleRate(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[derive(From, Into)]
#[serde(transparent)]
pub struct Hertz(pub f64);
```

The **`#[serde(transparent)]`** attribute is critical — it makes `TrackId("abc")` serialize as just `"abc"` rather than `{"0": "abc"}`, keeping the JSON clean for Tauri IPC. The `derive_more` crate eliminates boilerplate for `From`, `Into`, arithmetic operators, and `Display` — essential when you have dozens of newtypes.

For **Rust-to-TypeScript type synchronization**, `tauri-specta` v2 is the definitive solution. It generates fully typed TypeScript bindings from your `#[tauri::command]` functions and their argument/return types, including all nested types that derive `specta::Type`. The generated TypeScript includes typed wrapper functions — not just type definitions — eliminating any possibility of argument name mismatches or missing parameters:

```typescript
// Auto-generated by tauri-specta — DO NOT EDIT
export type TrackId = string; // from #[serde(transparent)]
export type Beats = number;
export type Decibels = number;

export type TrackInfo = {
    id: TrackId;
    name: string;
    volume: Decibels;
    muted: boolean;
};

export async function createTrack(name: string): Promise<TrackInfo> {
    return invoke('create_track', { name });
}
```

---

## Tauri commands live in the bridge, not the domain

Every **`#[tauri::command]`** function belongs in `src-tauri/src/commands/` — never in domain crates. Commands are thin wrappers that extract state, call domain logic, and translate errors. This keeps Tauri as a dependency only in the bridge crate and makes all domain logic testable without Tauri.

```rust
// src-tauri/src/commands/transport.rs
use tauri::State;
use daw_core::{Beats, TransportState};
use crate::state::AppState;
use crate::error::ApiError;

#[tauri::command]
#[specta::specta]
pub async fn play(state: State<'_, AppState>) -> Result<(), ApiError> {
    state.engine.play();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn seek(state: State<'_, AppState>, position: Beats) -> Result<(), ApiError> {
    state.engine.seek(position)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_transport_state(
    state: State<'_, AppState>
) -> Result<TransportState, ApiError> {
    Ok(state.engine.transport_state())
}
```

The **state wiring** happens in `lib.rs`. Tauri v2's `manage()` system registers each type once, and commands receive it via `State<'_, T>`. For a DAW, consolidate into a single `AppState` struct rather than managing many individual types:

```rust
// src-tauri/src/state.rs
use std::sync::Arc;
use tokio::sync::Mutex;
use daw_engine::EngineHandle;
use daw_io::ProjectManager;

pub struct AppState {
    pub engine: Arc<EngineHandle>,
    pub project: Mutex<ProjectManager>,
}
```

```rust
// src-tauri/src/lib.rs
mod commands;
mod state;
mod error;
mod relay;

pub fn run() {
    let (invoke_handler, register_events) = {
        let builder = tauri_specta::ts::builder()
            .commands(tauri_specta::collect_commands![
                commands::transport::play,
                commands::transport::stop,
                commands::transport::seek,
                commands::tracks::create_track,
                commands::tracks::set_volume,
                commands::project::open_project,
                commands::project::save_project,
                // ... all commands
            ])
            .events(tauri_specta::collect_events![/* typed events */]);

        #[cfg(debug_assertions)]
        let builder = builder.path("../src/generated/bindings.ts");

        builder.build().unwrap()
    };

    tauri::Builder::default()
        .manage(state::AppState {
            engine: Arc::new(EngineHandle::new(Default::default())),
            project: Mutex::new(ProjectManager::new()),
        })
        .invoke_handler(invoke_handler)
        .setup(|app| {
            register_events(app);
            relay::start_meter_relay(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
```

**Error handling** follows the Tauri v2 pattern of `thiserror` enums with a manual `Serialize` implementation. Domain errors translate to frontend-friendly structured errors at the bridge boundary:

```rust
// src-tauri/src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid input: {0}")]
    BadRequest(String),
    #[error("Engine error: {0}")]
    Engine(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for ApiError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ApiError", 2)?;
        state.serialize_field("code", &match self {
            ApiError::NotFound(_) => "NOT_FOUND",
            ApiError::BadRequest(_) => "BAD_REQUEST",
            ApiError::Engine(_) => "ENGINE_ERROR",
            ApiError::Io(_) => "IO_ERROR",
        })?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
```

---

## The audio thread architecture demands a hard RT/non-RT boundary

This is the most architecturally critical part of the DAW. The audio thread running inside cpal's callback **must never allocate, lock a mutex, perform I/O, or call any function with unbounded execution time**. Rust's ownership model helps but does not enforce this — you need `assert_no_alloc` in debug builds to catch violations.

The proven pattern from Firewheel and professional audio engines is the **compiled schedule** approach:

```
┌─────────────────────┐     rtrb (commands)     ┌──────────────────────┐
│   NON-RT THREAD     │ ──────────────────────→  │    RT AUDIO THREAD   │
│                     │                          │                      │
│  Graph topology     │     rtrb (events)        │  Compiled schedule   │
│  (petgraph)         │ ←──────────────────────  │  (flat Vec iteration)│
│                     │                          │                      │
│  Schedule compiler  │     basedrop/SharedCell  │  Scratch buffers     │
│  EngineHandle API   │ ──────────────────────→  │  Meter accumulators  │
└─────────────────────┘                          └──────────────────────┘
```

The `daw-engine` crate encapsulates this entire architecture. `EngineHandle` lives on the non-RT side and communicates with the audio thread exclusively through lock-free channels:

```rust
// daw-engine/src/lib.rs
pub struct EngineHandle {
    command_tx: rtrb::Producer<EngineCommand>,
    event_rx: rtrb::Consumer<EngineEvent>,
    graph: AudioGraph,          // petgraph StableGraph — non-RT owned
    meter_data: Arc<AtomicMeterData>,  // Atomically shared
}

// daw-engine/src/commands.rs (private)
enum EngineCommand {
    Play,
    Stop,
    Seek(Beats),
    SwapSchedule(Box<CompiledSchedule>),
    SetParameter { node_id: NodeId, param_id: u32, value: f32 },
}

enum EngineEvent {
    PlaybackFinished,
    ScheduleSwapped,   // Old schedule can now be deallocated
    BufferUnderrun,
}
```

The **compiled schedule** is a flat `Vec<ProcessTask>` produced by topologically sorting the audio graph on the non-RT thread. When the user adds a track, inserts an effect, or changes routing, `EngineHandle` modifies its petgraph `StableGraph`, runs `petgraph::algo::toposort`, builds a new `CompiledSchedule`, and sends it to the RT thread via the ring buffer. The RT thread simply iterates the flat vector — no graph traversal, no hash lookups, **O(n)** with perfect cache locality:

```rust
// daw-engine/src/audio_thread.rs
struct AudioThread {
    schedule: Option<Box<CompiledSchedule>>,
    buffers: Vec<Vec<f32>>,
    command_rx: rtrb::Consumer<EngineCommand>,
    event_tx: rtrb::Producer<EngineEvent>,
    meter_data: Arc<AtomicMeterData>,
}

impl AudioThread {
    fn process(&mut self, output: &mut [f32]) {
        // 1. Drain commands (non-blocking, wait-free)
        while let Ok(cmd) = self.command_rx.pop() {
            match cmd {
                EngineCommand::SwapSchedule(new) => {
                    let _old = self.schedule.replace(new);
                    // _old dropped here — use basedrop if it contains heap data
                    let _ = self.event_tx.push(EngineEvent::ScheduleSwapped);
                }
                EngineCommand::Play => { /* set playing flag */ }
                // ...
            }
        }

        // 2. Execute schedule
        if let Some(schedule) = &self.schedule {
            for task in &schedule.tasks {
                task.process(&mut self.buffers);
            }
        }

        // 3. Copy master output + update meters atomically
        output.copy_from_slice(&self.buffers[0]);
        self.meter_data.update_from(output);
    }
}
```

**Who owns the graph?** `EngineHandle` owns the authoritative graph topology on the non-RT thread. The RT thread only ever sees immutable compiled schedules. This is the pattern Firewheel uses (with `thunderdome` arenas instead of petgraph) and what Dropseed/Meadowlark planned.

For **RT-safe deallocation**, use `basedrop` or the `audio-garbage-collector` wrapper crate. When the RT thread drops an old schedule or buffer, the deallocation is deferred to a background collector thread rather than happening in the audio callback. Firewheel uses `rtgc` for the same purpose.

For **simple parameters** (volume, pan, bypass), `AtomicF32` from the `atomic_float` crate is sufficient — pipe through a one-pole smoothing filter to avoid zipper noise. For complex state changes, send them as commands through the ring buffer.

---

## The UI relay bridges real-time data to Tauri Channels

Tauri v2 distinguishes between **Events** (multi-consumer, JSON-only, not designed for low latency) and **Channels** (ordered streaming, optimized binary/JSON, fast). For meter data at **60fps**, Channels are the correct choice.

The relay runs on a dedicated thread that polls the audio engine's atomic meter data and pushes it through a Tauri Channel:

```rust
// src-tauri/src/relay.rs
use tauri::{AppHandle, Manager, ipc::Channel};
use std::time::Duration;

#[tauri::command]
#[specta::specta]
pub fn start_meter_stream(
    state: tauri::State<'_, AppState>,
    channel: Channel<MeterSnapshot>,
) {
    let engine = state.engine.clone();
    std::thread::spawn(move || {
        loop {
            let meters = engine.get_meter_data();
            if channel.send(MeterSnapshot::from(meters)).is_err() {
                break; // Channel closed, frontend disconnected
            }
            std::thread::sleep(Duration::from_millis(16)); // ~60fps
        }
    });
}
```

The **transport position**, **waveform display data**, and **plugin parameter feedback** all flow through the same Channel mechanism. This is the "UI relay" pattern — the relay drains data from the RT-safe atomic/ring-buffer layer and reformats it into Tauri-friendly serializable types. The bridge owns this reconciliation: it receives high-level commands from the frontend ("set track 3 volume to -6dB"), translates them into `EngineCommand` enum variants, and pushes them into the ring buffer.

---

## Cross-platform audio uses cpal feature flags and runtime fallback

cpal abstracts platform differences behind a unified API. Platform-specific backends are selected via Cargo feature flags, and your workspace `Cargo.toml` can use target-specific dependencies:

```toml
# In daw-engine/Cargo.toml
[dependencies]
cpal = { workspace = true }

[target.'cfg(target_os = "windows")'.dependencies]
cpal = { workspace = true, features = ["asio"] }

[target.'cfg(target_os = "linux")'.dependencies]
cpal = { workspace = true, features = ["jack", "pipewire"] }
```

At runtime, implement a fallback chain that tries professional backends first:

```rust
fn create_host() -> cpal::Host {
    #[cfg(target_os = "windows")]
    {
        cpal::host_from_id(cpal::HostId::Asio)
            .unwrap_or_else(|_| cpal::default_host()) // Falls back to WASAPI
    }
    #[cfg(target_os = "linux")]
    {
        cpal::host_from_id(cpal::HostId::Jack)
            .or_else(|_| cpal::host_from_id(cpal::HostId::PipeWire))
            .unwrap_or_else(|_| cpal::default_host()) // Falls back to ALSA
    }
    #[cfg(target_os = "macos")]
    { cpal::default_host() } // CoreAudio is always the right choice
}
```

ASIO on Windows requires the Steinberg ASIO SDK and LLVM for bindgen. **JACK** is available on all three platforms and provides inter-application audio routing. On Linux, PipeWire has become the modern default, replacing both PulseAudio and JACK — when PipeWire is running, it often holds the ALSA device exclusively, so the PipeWire backend should be preferred over raw ALSA.

---

## Testing DSP directly is Rust's major advantage over Web Audio

Unlike your TypeScript frontend where testing audio requires mocking Web Audio APIs, Rust DSP code processes raw `&[f32]` buffers — **unit testing is trivial**:

```rust
#[test]
fn gain_at_minus_6db_halves_amplitude() {
    let mut proc = GainProcessor::new(Decibels(-6.02));
    let input = vec![1.0, -1.0, 0.5, -0.5];
    let mut output = vec![0.0; 4];
    proc.process(&input, &mut output);
    for (inp, out) in input.iter().zip(output.iter()) {
        assert!((out - inp * 0.5).abs() < 1e-4);
    }
}
```

**Property-based testing** with `proptest` catches edge cases that unit tests miss — feed random sample buffers and assert invariants like "output never exceeds input amplitude for a gain ≤ 0dB" or "passthrough at 0dB produces bit-identical output." Use `mockall` to mock repository traits for testing command handlers without I/O. For lock-free code, the `loom` crate exhaustively tests all possible thread interleavings.

The key testing strategy: **test domain logic directly through `EngineHandle` and DSP functions, never through Tauri commands**. Tauri commands are thin wrappers — if the domain logic is correct, the commands work.

---

## Conclusion

The architecture distills to three layers with strict dependency direction: **`daw-core`** (types, zero dependencies) → **domain crates** (`daw-engine`, `daw-dsp`, `daw-io`, `daw-plugin-host`) → **`src-tauri`** (bridge only). This mirrors your TypeScript DDD modules while adding Rust's unique constraint: the hard wall between real-time and non-real-time code paths.

The compiled schedule pattern — petgraph on the non-RT side, flat `Vec` iteration on the RT side, connected by rtrb ring buffers — is the consensus architecture across Firewheel, Meadowlark, and professional C++ DAWs translated to Rust idioms. `tauri-specta` v2 eliminates the type synchronization problem entirely by generating typed TypeScript functions from Rust command signatures. And keeping all `#[tauri::command]` functions in the bridge layer means your audio engine is testable, reusable, and completely decoupled from the UI framework.

Start with **fewer crates than you think you need**. You can always extract a module into its own crate later — Rust's module system makes this a mechanical refactor. Meadowlark's most important lesson was that architectural ambition must be balanced against maintenance reality for a small team.
