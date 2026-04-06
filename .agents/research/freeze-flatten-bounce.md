# Freeze, Flatten, Bounce, and Commit: A deep technical specification

**Freeze-to-audio operations are the single most impactful CPU-saving feature a DAW can offer, yet every major DAW implements them differently — and all share the same painful edge cases.** This specification distills the UX semantics of seven commercial DAWs into a unified architecture for a TypeScript/CRDT frontend and Rust/CPAL backend, covering the offline render pipeline, a CRDT-native freeze-layer state model, and a garbage-collection strategy for rendered files. The core design principle: **the same audio graph definition drives both real-time playback and offline rendering, differing only in the executor**.

---

## How every major DAW handles rendering tracks to audio

The terminology varies — Freeze, Flatten, Bounce in Place, Commit, Transform, Render in Place — but all DAWs solve the same problem: replace live plugin processing with pre-rendered audio to reclaim CPU. The differences lie in reversibility, what gets baked in, and how much control the user has.

### Ableton Live: Freeze + Flatten (now Bounce Track in Place)

Ableton's Freeze renders each clip to a **32-bit float WAV** stored in `Samples/Processed/Freeze/`. All insert effects and clip automation are baked in; **sends, volume, and pan remain live and editable**. MIDI clips display as waveforms with a cross-hatched overlay. Users can still launch clips, edit mixer parameters, cut/copy/paste clips, and record clip launches into the arrangement. They cannot edit MIDI notes, change plugin parameters, or modify warp settings.

Sidechain routing creates a hard constraint: Ableton **refuses to freeze any track with an active sidechain input**, surfacing an error dialog. The workaround — freeze the sidechain source first — is unintuitive and a top-five user complaint. In Arrangement View, reverb/delay tails generate separate "tail clips" adjacent to the main frozen clips; in Session View, tails fold into the clip but only two loop cycles are rendered.

As of **Live 12.2**, Flatten was renamed **Bounce Track in Place**. It permanently replaces all clips and devices with rendered audio (post-FX, pre-mixer). The MIDI track becomes an audio track. A companion command, **Bounce to New Track** (`Cmd+B`), renders a selection to a separate audio track while muting source clips — non-destructive by default. Flatten/Bounce is undoable via `Cmd+Z` but only before the project is saved and closed.

### Logic Pro: two freeze modes and granular bouncing

Logic offers two freeze modes via a snowflake button in the track header. **Source Only** renders just the instrument (effects stay live and editable), displaying a blue freeze indicator. **Pre-Fader** renders the full signal chain including effects (green indicator). Both modes render track automation into the frozen audio. While frozen, only mute/solo/volume/pan remain adjustable — no region editing at all. Notably, **Logic cannot freeze multi-output software instruments**, a persistent pain point for orchestral composers using Kontakt.

**Bounce in Place** (`Ctrl+Cmd+B`) opens a dialog with extensive options: include/exclude insert effects, include audio tail in file and/or region, include volume/pan automation, normalization (off / overload protection / full), destination (new track or selected track), and source granularity (one file, one per track, or one per region). When bouncing a track in place, the original content is **permanently lost** — the track becomes a flat audio track. This contrasts with freeze, which is fully reversible.

Logic has a **documented PDC bug with automation**: automation on tracks with latency-inducing plugins can fire at incorrect times during freeze rendering. This has persisted across multiple Logic versions and affects freeze accuracy for linear-phase EQs, UAD plugins, and similar high-latency processors.

### Pro Tools: Freeze for speed, Commit for control

Pro Tools added Freeze in **v12.4** and Commit in **v12.3**. Freeze is the simpler operation: click the snowflake, and the track renders offline to `-FZ` suffixed files in `Session/Rendered Files/`. All inserts, clip gain, clip effects, Elastic Audio, and ARA plugins are baked in. Volume, pan, sends, and mute remain live. Frozen tracks display a semi-transparent angled pattern overlay with MIDI notes visible but not editable.

**Freeze Up To This Insert** is a standout feature — right-click a specific plugin to freeze only processing up to that point, keeping downstream effects live and editable. This partial-freeze capability is absent from Ableton and rare across DAWs.

**Commit** creates a **new audio track** (`.cm` suffix) with the rendered output. Its dialog offers: scope (selected tracks or edit selection), consolidate clips toggle, render volume/mute option, and four source-track handling modes — _Hide and Make Inactive_ (recommended, preserves originals), _Make Inactive_, _Delete_ (destructive), or _Do Nothing_. Like Freeze, Commit supports **partial commit up to a specific insert**. Commit is the most feature-rich rendering operation across all surveyed DAWs.

A critical limitation: **Pro Tools cannot freeze external hardware inserts** because freeze uses offline rendering, which can't route audio through physical hardware faster-than-realtime. Silence is rendered instead.

### The rest of the field

| DAW            | Feature                       | Standout capability                                                                                                                   | Key limitation                                                                                         |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Cubase**     | Render in Place               | Four render depth levels (Dry → Channel → Complete Path → Complete + Master); "Dry" transfers channel settings without baking them in | Multi-output rack instruments render ALL outputs even when only one is selected                        |
| **Studio One** | Transform to Audio            | **Auto Tail** detection for reverb/delay; bidirectional transform (audio ↔ instrument); preserves state for revert                    | Reverting discards volume changes made while transformed                                               |
| **Reaper**     | Freeze / Apply FX as New Take | Selective freeze up to a chosen FX; take system preserves originals non-destructively; deeply scriptable                              | No one-click freeze button in default UI; stem render bakes fader position (causes double-attenuation) |
| **FL Studio**  | Consolidate                   | Flexible rendering quality settings; leave/cut remainder for tails                                                                    | No dedicated freeze feature — most-requested missing feature for years                                 |
| **Bitwig**     | Bounce / Bounce In Place      | **Hybrid tracks** (audio + MIDI coexist); Custom source point picking any device in chain                                             | No tail handling for Bounce In Place; no dedicated freeze-and-disable workflow                         |

---

## UX semantics comparison across all operations

| Dimension             | Ableton Freeze             | Ableton Flatten/BIP         | Logic Freeze                    | Logic BIP               | Pro Tools Freeze             | Pro Tools Commit             | Cubase RIP                 | Studio One Transform             |
| --------------------- | -------------------------- | --------------------------- | ------------------------------- | ----------------------- | ---------------------------- | ---------------------------- | -------------------------- | -------------------------------- |
| **Reversible**        | Yes (Unfreeze)             | Undo only                   | Yes (Unfreeze)                  | Undo only               | Yes (Unfreeze)               | Via hidden source track      | Via source track option    | Yes (Preserve State)             |
| **Creates new track** | No                         | No (12.1) / Optional (12.2) | No                              | Yes or replaces         | No                           | Yes (`.cm` track)            | Yes                        | Replaces in-place                |
| **Inserts baked in**  | Yes                        | Yes                         | Source Only: No; Pre-Fader: Yes | Optional                | Yes                          | Yes (or partial)             | 4-level control            | Optional                         |
| **Sends baked in**    | No (remain live)           | No                          | No                              | No                      | No                           | No (optionally copied)       | Only in Complete Path mode | No (preserved)                   |
| **Volume/pan baked**  | No                         | No                          | Yes (automation)                | Optional                | No                           | Optional                     | Depends on mode            | Yes (resets to default)          |
| **Partial freeze**    | No                         | N/A                         | Source Only mode                | N/A                     | Yes (up to insert)           | Yes (up to insert)           | Yes (Dry mode)             | Optional (Render Inserts toggle) |
| **Tail handling**     | Separate tail clips (Arr.) | Inherited                   | Included                        | Auto/manual tail option | Extended clips               | Extended clips               | Manual (sec/bars)          | Auto Tail detection              |
| **File format**       | 32-bit float WAV           | 32-bit float WAV            | 32-bit float                    | Project settings        | Session format (mono)        | Session format               | 16/24/32-bit selectable    | Project settings                 |
| **Sidechain support** | Blocked (error)            | If source frozen            | Limited                         | Rendered during bounce  | Rendered if source available | Rendered if source available | Via Complete Signal Path   | Partial                          |

---

## The ten pitfalls users hit most often

The same complaints recur across every DAW forum — Reddit, Gearspace, KVR, VI-Control — because the underlying architectural challenges are universal.

**Sidechain routing breaks freeze in isolation.** This is the most fundamental problem: sidechain requires inter-track communication, but freeze renders a single track in isolation. Ableton blocks the operation entirely. Logic and others silently render without the sidechain signal, producing incorrect audio. The only robust solution is to identify sidechain dependencies during the graph analysis phase and either render dependency tracks first or render the subgraph together.

**Sends are never baked in (except Cubase's Complete Signal Path mode).** Every DAW leaves sends live on frozen tracks, which is usually correct behavior — but users frequently expect send effects to be included and are surprised when freeze files sound "dry." The specification below supports an explicit `includeSends` option.

**Reverb/delay tails get truncated.** Unless the DAW auto-detects tail length (only Studio One does this well), users must manually extend selections or arrangement length. The specification addresses this by querying `tail_samples()` from all plugins in the chain and continuing the render past content end.

**Automation timing drifts due to PDC.** Logic has a documented bug where automation on high-latency plugins fires at incorrect times during freeze. Ableton's PDC compensation for automation has improved but remains imperfect with group tracks. Reaper is generally regarded as having the most accurate PDC implementation.

**Multi-output instruments can't be frozen.** Logic disables freeze entirely for multi-output instruments. Cubase renders all outputs even when only one is selected. This remains an unsolved UX problem — the specification below recommends rendering each output as a separate freeze file linked to the parent instrument.

Other recurring issues include: **frozen tracks losing editability** (users forget they've frozen and can't find the unfreeze option), **project bloat from repeated freeze/unfreeze cycles** (orphaned WAV files accumulate), **missing plugins after sharing** (recipient can play freeze files but can't unfreeze), **CPU spikes during render** (particularly with large orchestral templates), and **undo limitations after save** (flatten/commit becomes irreversible once the project is saved and closed).

---

## Offline render pipeline in Rust

### Why CPAL is not the answer for offline rendering

CPAL is strictly a **real-time audio I/O library** — it requires a physical audio device and is driven by device-rate callbacks. Offline rendering bypasses CPAL entirely. The output stage uses `hound` for WAV writing and `symphonia` for audio file decoding. The render loop is a tight `while` loop that pulls samples through the audio graph as fast as the CPU allows.

### The pull-based graph model with dual executors

Open-source DAWs converge on the same architecture: **a single audio graph definition with interchangeable drivers**. Ardour shares its entire processing graph between real-time and offline modes — it tells the JACK/ALSA backend to enter "freewheel mode" where the same `process()` callback runs without waiting for the hardware clock. LMMS calls the same `AudioEngine::renderNextBuffer()` from either the real-time FIFO writer thread or the offline `ProjectRenderer` thread. Both approaches avoid code duplication.

The recommended Rust architecture formalizes this as a **GraphExecutor trait pattern**:

```rust
/// Every node in the audio graph implements this trait
pub trait AudioNode: Send {
    fn process(
        &mut self,
        context: &ProcessContext,
        inputs: &[&AudioBuffer],
        output: &mut AudioBuffer,
    );
    fn reset(&mut self);
    fn latency_samples(&self) -> u64;
    fn tail_samples(&self) -> u64;
}

/// Context shared between real-time and offline paths
pub struct ProcessContext {
    pub sample_rate: f64,
    pub block_size: usize,
    pub transport: TransportState,
    pub is_offline: bool,  // Plugins can adjust quality (VST3 kOffline)
    pub tempo_map: Arc<TempoMap>,
}

/// The graph itself is executor-agnostic
pub struct AudioGraph {
    nodes: Vec<Box<dyn AudioNode>>,
    schedule: Vec<usize>,          // Topologically sorted via Kahn's algorithm
    connections: Vec<Connection>,
    buffers: Vec<AudioBuffer>,     // Pre-allocated intermediate buffers
}

impl AudioGraph {
    pub fn process_block(&mut self, context: &ProcessContext) {
        for &node_idx in &self.schedule {
            let inputs = self.gather_inputs(node_idx);
            let output = &mut self.buffers[node_idx];
            self.nodes[node_idx].process(context, &inputs, output);
        }
    }
}
```

The **real-time executor** wraps CPAL and calls `graph.process_block()` inside the audio callback with `is_offline: false` and the hardware-determined block size (typically 256–512 samples). The **offline executor** runs a tight loop with a larger block size (4096–8192 samples, following Ardour's `bounce_chunk_size = 8192`) and writes output to a `hound::WavWriter`:

```rust
pub struct OfflineExecutor;

impl OfflineExecutor {
    pub fn render_to_file(
        graph: &mut AudioGraph,
        duration_samples: u64,
        tail_samples: u64,
        output_path: &Path,
        sample_rate: u32,
    ) -> Result<RenderResult, FreezeError> {
        let temp_path = output_path.with_extension("tmp.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut writer = hound::WavWriter::create(&temp_path, spec)?;
        let block_size = 8192;
        let total_samples = duration_samples + tail_samples;
        let total_blocks = (total_samples + block_size as u64 - 1) / block_size as u64;
        let context = ProcessContext {
            sample_rate: sample_rate as f64,
            block_size,
            is_offline: true,
            ..Default::default()
        };

        for block in 0..total_blocks {
            graph.process_block(&context);
            let master = graph.master_output();
            for &sample in master.iter() {
                writer.write_sample(sample)?;
            }
            // Report progress via channel
        }
        writer.finalize()?;
        std::fs::rename(&temp_path, output_path)?; // Atomic commit
        Ok(RenderResult { output_path: output_path.to_path_buf(), .. })
    }
}
```

### Thread safety: cloning the graph for concurrent render

The real-time audio thread cannot share mutable plugin state with an offline render thread. The solution is to **snapshot the graph state and instantiate fresh plugin instances** on the render thread:

```rust
pub fn freeze_track(
    track_id: &str,
    graph: &AudioGraph,
    settings: &RenderSettings,
) -> JoinHandle<Result<RenderResult, FreezeError>> {
    // Serialize plugin states on the main thread
    let graph_snapshot = graph.serialize_track_subgraph(track_id);

    std::thread::spawn(move || {
        // Reconstruct graph with fresh plugin instances
        let mut offline_graph = AudioGraph::from_snapshot(&graph_snapshot)?;
        OfflineExecutor::render_to_file(
            &mut offline_graph,
            graph_snapshot.duration_samples,
            graph_snapshot.max_tail_samples,
            &graph_snapshot.output_path,
            settings.sample_rate,
        )
    })
}
```

For VST3 plugins, the host must call `setupProcessing()` with `processMode = kOffline` before offline rendering — this lets plugins activate higher-quality algorithms. CLAP plugins receive the offline indicator through the process context. Some plugins (convolution reverbs using `zita-convolver`, hardware-accelerated UAD plugins, time-dependent LFOs) behave differently in offline mode, so **a real-time render fallback** should be offered as a user option.

### Handling sidechain and send dependencies

When freezing a track with sidechain inputs or send routing, the offline graph must include all upstream dependencies. The approach:

1. **Build a dependency subgraph** via topological sort, including the target track, all sidechain source tracks, and (optionally) send/return buses.
2. **Render the subgraph** with all dependencies active, capturing only the target track's output.
3. **Calculate render length** by querying `tail_samples()` from every node in the chain. For plugins reporting `kInfiniteTail` (VST3) or equivalent, fall back to silence detection — continue rendering until output RMS drops below **-96 dB** for 512 consecutive samples.

### Recommended crate stack

| Purpose                | Crate                                | Role in freeze pipeline                      |
| ---------------------- | ------------------------------------ | -------------------------------------------- |
| Real-time I/O          | `cpal`                               | Drives real-time executor only               |
| WAV writing            | `hound`                              | Offline render output                        |
| Audio decoding         | `symphonia`                          | Read source audio clips                      |
| Audio graph            | Custom (or `audio_graph`)            | DAG with typed ports, topological scheduling |
| DSP utilities          | `dasp`                               | Sample type conversions, buffer operations   |
| Plugin hosting         | `clack` (CLAP) / custom VST3 wrapper | Plugin instantiation and state serialization |
| Sample rate conversion | `rubato`                             | When render sample rate differs from project |

---

## Freeze-layer state model for the TypeScript CRDT

### Why Loro over Yjs or Automerge

The CRDT library recommendation is **Loro** (`loro.dev`). It is implemented natively in Rust with JavaScript/TypeScript bindings via WASM — both sides of the Tauri app work with the same CRDT engine natively. Loro provides **MovableList** (reorderable tracks and clips with proper concurrent merge via the Fugue algorithm), **MovableTree** (hierarchical track/bus structures), **Map** (LWW for per-track properties), and a built-in **UndoManager** with per-peer local undo/redo. It supports time-travel checkout to any version via Frontiers.

Yjs has a larger ecosystem and subdocument support for lazy-loading, but lacks native Rust, MovableTree, and MovableList. Automerge has Rust + JS bindings but higher memory overhead and no MovableTree/MovableList. No existing CRDT-based DAW was found during research — this would be novel.

### The freeze layer sits atop original clip data

Original MIDI/audio clips are **never modified** during freeze. Instead, a `freezeState` map is added to each track in the CRDT, acting as a transparent overlay that the audio engine reads preferentially:

```typescript
interface FreezeState {
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'unfreezing';
    freezeId?: string;
    frozenAudioPath?: string; // "freeze/track_abc_1714567890.wav"
    frozenAudioHash?: string; // SHA-256 of rendered file
    frozenAudioDurationSamples?: number;
    sourceContentHash?: string; // SHA-256 of clips + positions + gains
    pluginChainHash?: string; // SHA-256 of ordered plugin IDs + states
    renderSettings?: {
        sampleRate: number;
        bitDepth: number;
        bufferSize: number;
        channelCount: number;
        tailLengthMs: number;
    };
    renderedAt?: number; // Unix epoch ms (UTC)
    renderedByPeer?: string;
    engineVersion?: string;
    renderProgress?: number; // 0.0-1.0 during 'freezing'
}
```

### State machine transitions

```
         ┌──────────┐
  ┌──────│ unfrozen  │◄──────────────┐
  │      └─────┬─────┘               │
  │            │ freeze()            │ unfreeze()
  │            ▼                     │
  │      ┌──────────┐               │
  │      │ freezing  │──────────────┤  (cancel or fail → unfrozen)
  │      └─────┬─────┘               │
  │            │ render complete     │
  │            ▼                     │
  │      ┌──────────┐               │
  │      │  frozen   │──────────────┘
  │      └─────┬─────┘
  │            │ source content changed (hash mismatch)
  │            ▼
  │      ┌──────────┐
  └──────│  stale    │  → user re-freezes or unfreezes
         └──────────┘
```

The Rust audio engine reads the freeze status on every block and switches behavior accordingly:

```rust
impl TrackProcessor {
    pub fn process_block(&mut self, buffer: &mut AudioBuffer, ctx: &ProcessContext) {
        match &self.freeze_state {
            FreezeStatus::Frozen { .. } | FreezeStatus::Stale { .. } => {
                // Read pre-rendered audio, skip all plugins
                self.read_frozen_audio(buffer, ctx);
            }
            _ => {
                // Normal: clips → plugin chain → output
                self.process_clips(buffer, ctx);
                self.plugin_chain.process(buffer, ctx);
            }
        }
    }
}
```

### Staleness detection via content hashing

When any clip or plugin on a frozen track changes in the CRDT, the frontend recomputes the source content hash and compares it against the freeze metadata:

```typescript
function computeSourceHash(clips: ClipData[], plugins: PluginData[]): string {
    const hasher = new Sha256();
    for (const clip of clips.sort((a, b) => a.startTick - b.startTick)) {
        hasher.update(
            `${clip.id}:${clip.startTick}:${clip.durationTicks}:` + `${clip.audioFileHash ?? ''}:${clip.gain}`
        );
    }
    for (const plugin of plugins) {
        hasher.update(`${plugin.pluginId}:${plugin.stateHash}:${plugin.bypassed}`);
    }
    return hasher.digest('hex');
}
```

If the hash differs, the UI transitions the track to **stale** — frozen audio still plays (preventing CPU spike), but a visual indicator prompts the user to re-freeze or unfreeze.

### Flatten as a CRDT mutation

Flatten (the destructive commit) replaces original clips with audio clip references and removes plugins from the track. Before executing, the system checks for staleness and warns the user:

```typescript
function flattenTrack(doc: LoroDoc, trackId: string) {
    const track = getTrackMap(doc, trackId);
    const freeze = track.get('freezeState');
    if (freeze.get('status') !== 'frozen') throw new Error('Track must be frozen');

    const undoManager = new UndoManager(doc);
    undoManager.startGroup();

    // Replace clips with a single audio clip referencing the freeze file
    const clips = track.getContainer('clips');
    clips.clear();
    const audioClip = new LoroMap();
    audioClip.set('type', 'audio');
    audioClip.set('startTick', 0);
    audioClip.set('audioFileRef', freeze.get('frozenAudioPath'));
    audioClip.set('audioFileHash', freeze.get('frozenAudioHash'));
    audioClip.set('durationTicks', freeze.get('frozenAudioDurationSamples'));
    clips.push(audioClip);

    // Move freeze file from freeze/ to audio/ (promote to permanent)
    // Clear plugin chain
    track.getContainer('plugins').clear();
    // Reset freeze state
    freeze.set('status', 'unfrozen');
    track.set('type', 'audio');

    undoManager.endGroup();
    doc.commit();
}
```

### Tauri IPC: event-driven sync with debounced batching

The TypeScript CRDT is the **source of truth**. The Rust backend maintains a derived, read-optimized audio graph representation. Synchronization uses **Tauri commands** (request/response) for state pushes and **Tauri events** (async notifications) for render completion, progress, and errors.

CRDT changes are debounced into **16ms batches** (one animation frame). If fewer than 10 tracks changed, incremental per-track updates are sent; if more, a full project snapshot is pushed. This prevents IPC flooding during rapid editing while keeping the audio engine responsive.

```typescript
// Frontend subscribes to CRDT changes
doc.subscribe((event) => {
    for (const e of event.events) {
        const trackId = extractTrackId(e.path);
        if (trackId) pendingTrackIds.add(trackId);
    }
    scheduleSyncFlush(); // 16ms debounce
});

// Backend emits events for async operations
listen('freeze-complete', (ev) => {
    const { trackId, metadata } = ev.payload;
    const currentHash = computeSourceHash(track.clips, track.plugins);
    const status = currentHash === metadata.sourceContentHash ? 'frozen' : 'stale';
    updateFreezeStatus(trackId, status, metadata);
});
```

For type-safe IPC, the **taurpc** crate auto-generates TypeScript types from Rust trait definitions using Specta, eliminating manual type synchronization.

---

## Disk garbage collection for rendered freeze files

### The bloat problem

A user who freezes a track, unfreezes to tweak a synth parameter, and re-freezes generates a new WAV file each cycle — the previous one becomes orphaned. In a typical session with **50 tracks and 10 iterations**, this can accumulate gigabytes of dead files. Pro Tools explicitly stores freeze files in a `Rendered Files` folder with `-FZ` suffixes and does not clean them up automatically. Ableton stores them in `Samples/Processed/Freeze` and removes them on unfreeze for simple cases, but edge cases (External Instruments, multiple freeze/unfreeze cycles) can leave orphans.

### Project directory structure

```
MyProject/
├── project.loro              # CRDT binary document
├── audio/                    # Source audio (never auto-deleted)
│   ├── recording_001.wav
│   └── sample_drums.wav
├── freeze/                   # Rendered freeze files (GC candidates)
│   ├── track_abc_1714567890.wav
│   ├── track_abc_1714568901.wav.tmp   # Incomplete render (crash)
│   └── .freeze-manifest.json
├── cache/                    # Waveform previews, analysis
│   └── waveforms/
└── .undo-refs.json           # Freeze files referenced by undo history
```

### Hybrid mark-and-sweep with undo awareness

The GC strategy combines **reference marking** from the current CRDT state and undo history with **age-based eviction** inspired by Premiere Pro's cache management (90-day default, 10% volume cap, weekly housekeeping on launch):

1. **Mark phase**: Scan the current CRDT state for all `frozenAudioPath` references. Scan the undo history for freeze files referenced by undo entries. Union these into a "referenced" set.
2. **Sweep phase**: Walk the `freeze/` directory. Any file not in the referenced set and older than the age threshold (default: 7 days for active projects, immediate for unreferenced files at project close) is deleted.
3. **Trigger points**: Run conservative sweep on project save (keep files < 7 days), aggressive sweep on project close (delete all unreferenced), periodic check every 10 minutes (enforce total freeze folder size limit), and immediate marking of replaced files on re-freeze.

```rust
pub fn sweep_freeze_directory(
    freeze_dir: &Path,
    referenced: &HashSet<PathBuf>,
    max_age: Duration,
    max_total_bytes: u64,
) -> Result<SweepResult, io::Error> {
    let mut candidates: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    for entry in fs::read_dir(freeze_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension() == Some("tmp".as_ref()) {
            fs::remove_file(&path)?; // Always clean up incomplete renders
            continue;
        }
        if !referenced.contains(&path) {
            let meta = entry.metadata()?;
            candidates.push((path, meta.modified()?, meta.len()));
        }
    }
    // Sort oldest first, delete until under budget
    candidates.sort_by_key(|(_, time, _)| *time);
    let mut deleted = 0u64;
    for (path, mtime, size) in &candidates {
        if mtime.elapsed().unwrap_or_default() > max_age {
            fs::remove_file(path)?;
            deleted += size;
        }
    }
    Ok(SweepResult { files_deleted: deleted, .. })
}
```

### Atomic file writes prevent corruption

All freeze renders write to a `.tmp` file first and atomically rename on completion. On application startup, any `.tmp` files in `freeze/` are unconditionally deleted — they represent interrupted renders from a previous crash.

### Project packing and archiving

Three modes serve different sharing scenarios:

- **Full**: Include all freeze files. Largest archive, but loads instantly without re-rendering. Best for handoff to a mixing engineer.
- **Minimal**: Exclude all freeze files. Smallest archive; all frozen tracks must re-render on open. Best for backup/version control.
- **Smart** (default): Include freeze files only for tracks whose plugins may be unavailable on the recipient's system. The system checks each frozen track's `pluginChainHash` against locally installed plugins — if a plugin is missing, the freeze file is essential and gets included.

---

## Edge cases, failure modes, and their mitigations

### Crash during freeze render

The atomic temp-file pattern prevents partial WAV files from being treated as valid freezes. On crash recovery, the frontend sees `status: 'freezing'` in the CRDT with no corresponding `freeze-complete` event. A **watchdog timer** (5 minutes) transitions the state back to `unfrozen` and cleans up any `.tmp` files.

### CRDT modification during active freeze

The freeze captures a content hash at initiation time. If clips or plugins change during the render (the user edits while freezing), the completion handler re-checks hashes. If they differ, the track enters the **stale** state rather than **frozen** — the rendered audio is kept (it's still valid for playback of the old state) but the UI shows an "outdated freeze" indicator.

### Collaborative conflicts on freeze

When two peers freeze the same track simultaneously, both set the CRDT `freezeState` to `freezing`, both complete, and both write `frozen` with different audio file paths. Loro's LWW (Last-Writer-Wins) semantics on the Map resolve the conflict: **the later writer's freeze file wins**, and the losing file becomes orphaned for GC. To reduce this friction, the UI should display a lock indicator when any peer is actively freezing a track.

When User A freezes while User B edits the same track's content, A's freeze completes with A's snapshot. B's edits change the content hash. The staleness check fires, and both users see the track as **stale** — a clear signal that re-freezing is needed.

### Disk space exhaustion

Before rendering, the system estimates the output file size (`duration_seconds × sample_rate × channels × bytes_per_sample`) and checks available disk space with a **2x safety margin**. If space is insufficient, the freeze is rejected with a dialog prompting the user to free space or run GC on old freeze files. During rendering, write errors are caught, partial files are cleaned up, and the track reverts to `unfrozen`.

### Plugin state mismatch after freeze but before flatten

The `pluginChainHash` in freeze metadata enables a pre-flatten safety check. If the user changes a plugin parameter after freezing but before flattening, the hashes differ. The flatten dialog warns: _"Plugin settings changed since this track was frozen. Flattening will commit the older rendered audio, not the current plugin state."_ The user can choose to re-freeze first or proceed.

### Undo across freeze boundaries

Loro's built-in `UndoManager` groups freeze-related CRDT mutations (status change, metadata write, clip replacement for flatten) into a single undo step. Undoing a freeze restores `status: 'unfrozen'` and clears the freeze metadata. The rendered WAV file is not immediately deleted — it enters the GC pool, protected by the undo history reference tracking in `.undo-refs.json`. Undoing a flatten restores original clips, plugins, and track type from the CRDT history.

The most complex case is **undo after project close and reopen**: since undo history is per-session (not persisted in the CRDT), flatten becomes irreversible after the project is closed. The UI should warn users explicitly before flattening, matching the behavior of every surveyed DAW.

---

## Conclusion: design principles that emerged from this research

Three insights cut across all the UX research and technical analysis. First, **every DAW that separates "freeze" from "flatten/commit" gets better user satisfaction** than those offering only a one-step destructive operation. The two-phase model — reversible freeze for CPU savings, irreversible flatten for commitment — maps directly onto how musicians work: experiment freely, then lock down when confident. The specification's five-state machine (unfrozen → freezing → frozen → stale → unfrozen) adds staleness detection, which no surveyed commercial DAW currently implements.

Second, **the shared-graph-with-dual-executors pattern is battle-tested**. Ardour and LMMS both prove that a single `process_block()` function called by different drivers (real-time vs. offline) eliminates code duplication and ensures rendering fidelity matches playback. The Rust trait system makes this pattern particularly clean — `AudioGraph::process_block()` is executor-agnostic, and the `ProcessContext.is_offline` flag lets plugins switch quality modes.

Third, **CRDT-native freeze state is genuinely novel**. No surveyed DAW or collaborative audio application uses CRDTs for project state, and no existing system models freeze as a transparent overlay layer with content-hash-based staleness detection. The Loro-based architecture — with MovableList for track ordering, LWW maps for track properties, and hash-validated freeze metadata — provides correct concurrent behavior (two users can safely freeze different tracks simultaneously) while keeping the CRDT document as the single source of truth. The Rust backend becomes a pure derived consumer of this state, reading freeze status on every audio block to decide whether to play cached audio or process live.
