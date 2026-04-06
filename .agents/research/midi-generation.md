# Symbolic MIDI generation via local inference for a privacy-first DAW

**The most viable path to "Session Players" in a Tauri-based DAW is a tiered architecture: a rule-based core for instant, deterministic pattern generation, enhanced by a ~20–360M parameter transformer (the Anticipatory Music Transformer or MIDI-GPT) running via ONNX Runtime in Rust for expressive, chord-conditioned accompaniment.** This approach mirrors Apple Logic Pro's parametric design philosophy—sliders and XY pads rather than chat prompts—while remaining fully local and open-source. The key enabling technologies are the `ort` crate for GPU-accelerated inference, REMI+ tokenization for encoding musical context, and the Anticipatory Music Transformer's infilling mechanism for multi-track generation conditioned on a chord track. A 360M-parameter model can generate 4–8 bars of MIDI in under 3 seconds on consumer hardware, well within acceptable latency for an interactive DAW workflow.

---

## How Logic Pro's Session Players actually work

Apple's Session Players—Drummer (2013), Bass Player and Keyboard Player (May 2024, Logic Pro 11), and Synth Player (2025, Logic Pro 12)—represent the most polished commercial implementation of parametric virtual musicians. Understanding their design is essential for building a competitive alternative.

**Drummer** uses an **XY pad** where the Y-axis controls dynamics (Loud/Soft) and the X-axis controls rhythmic complexity (Simple/Complex). A draggable yellow puck sets the global character. Beyond this, per-instrument toggles (Kick, Snare, Toms, Hi-Hat, Cymbals, Tambourine, Shaker) with individual complexity sliders allow surgical control. The Details panel exposes **Feel** (push/pull relative to the beat), **Ghost Notes** (syncopated low-velocity hits), **Hi-Hat** openness, **Swing** (8th or 16th-note shuffle), **Fills** amount, and **Humanize**. Seven genre categories (Rock, Alternative, Songwriter, R&B, Electronic, Hip Hop, Percussion) contain **28+ virtual drummer characters**, each with ~8 presets.

**Bass Player** follows the global Chord Track automatically, generating MIDI that drives the Studio Bass plugin. Its parameters include **Complexity**, **Intensity**, **Melody** (melodic movement), **Octaves**, **Phrasing**, **Lowest Note** (4-string vs. 5-string), **Blue Notes & Slaps**, **Double Stops**, **Laid Back/Feel**, and **Swing**. Patterns are visualized as 16th-note dot grids. Apple describes the technology as "trained in collaboration with today's best bass players using advanced AI and sampling technologies" with a "microsampling" system containing hundreds of thousands of individual nuanced sounds. The output is MIDI, convertible to standard regions for manual editing.

**Keyboard Player** offers **Left/Right hand toggles**, **Voicing** selection (block chords to extended harmony), **Grace Notes**, **Complexity**, **Intensity**, and **Dynamics**. Four main styles include "Freely" (improvisational) and "Block Chord." It follows the Chord Track with the same mechanism as the Bass Player.

The underlying technology is a **hybrid of rule-based algorithms and trained models** generating MIDI, not audio loops. Apple's John Danty confirmed: "The underlying technology is MIDI. So that allows us to go in and speak directly to the audio plugins that we have." The system was built by modeling how musicians play rather than extracting performances from recordings, which is why it "took an extraordinarily long time."

**Common criticisms** reveal design lessons: users report **default complexity is too high** ("the very first thing I do is pull complexity way down"); Session Player regions **cannot be directly note-edited** without converting to MIDI (losing regeneration capability); there is **no guitarist**; and the keyboard player produces **more wrong notes at higher complexity**. These point to the importance of conservative defaults, non-destructive MIDI workflows, and constraining output to chord tones at high complexity.

### Why parametric controls dominate over text prompts

Every successful commercial system—Logic Pro, Band-in-a-Box, EZdrummer, Celemony Tonalic—uses parametric controls rather than text input. The reasons are structural, not merely aesthetic. **Sliders and XY pads enable real-time manipulation during playback**, producing sub-second feedback loops impossible with text-to-generation workflows. Specific parameter positions are **deterministic and reproducible**, encoded perfectly in project files—the same slider position always produces the same result. Producers develop **physical muscle memory** for parameter positions. Individual parameters like Ghost Notes or Hi-Hat openness allow **surgical adjustments** that natural language cannot express precisely. Academic research on text-to-music tools found "interpretive gaps often arise between the AI's output and the artist's intended vision," with producers reporting they had to modify their original ideas to accommodate unexpected model outputs.

That said, text conditioning has a role as a secondary interface. Models like text2midi and MuseCoco accept natural language descriptions translated to attribute tokens. The recommended approach is **parametric controls as the primary interface**, with optional natural-language presets that map to specific parameter configurations.

### The competitive landscape beyond Logic

**Band-in-a-Box** (PG Music, since 1988) pioneered auto-accompaniment with chord chart input driving 5 backing tracks. Its pre-2007 engine was purely rule-based MIDI generation—proof that algorithmic approaches can achieve commercial quality. Post-2007 **RealTracks** replaced MIDI with recorded audio from 100+ session musicians, pitch-shifted via the élastique Pro engine. As of 2023, it offers **3,737+ RealTracks** and **822+ RealDrums** across 9,000+ styles. Its strength is breadth; its weakness is a widely criticized dated UI.

**Celemony Tonalic** (announced NAMM 2026) takes a radically different approach: neither AI, loops, nor MIDI. It uses Melodyne DNA technology to manipulate 7,000+ recorded performance patterns from 30+ session musicians, preserving harmonic relationships. It supports guitar, bass, drums, and percussion with note-level editing in the Studio edition.

**EZdrummer 3's Bandmate** analyzes audio/MIDI from any instrument via transient detection and suggests matching drum grooves from its library. **Steinberg Cubase** offers a Chord Track and Chord Assistant for composition but no auto-accompaniment generation. **Ableton Live 12** provides algorithmic MIDI generators (Seed, Rhythm, Shape, Euclidean) but no virtual musicians.

---

## The best open-source models for local MIDI generation

After surveying arXiv, HuggingFace, and GitHub, five models emerge as the strongest candidates for a local-first DAW, evaluated on chord conditioning, multi-track support, model size, license, and ONNX viability.

### Anticipatory Music Transformer — the top candidate

The **Anticipatory Music Transformer** (Thickstun et al., 2023, Stanford) is the single best model for this use case. Available in three sizes—**128M** (`music-small-800k`), **360M** (`music-medium-800k`), and **780M** (`music-large-800k`) parameters—it uses a GPT-style decoder trained on the Lakh MIDI dataset and licensed **Apache-2.0**. Its key innovation is the **anticipation mechanism**: control events (notes from a fixed track) are interleaved into the generation sequence at positions determined by a lookahead parameter δ (typically 5 seconds). This means you provide a chord voicing track as controls, and the model generates accompaniment that respects those chords.

Multi-track generation is native—instrument identity is encoded directly in the note token as `n = 128k + p` (instrument × pitch). You can fix any subset of instruments as controls and generate the rest. The authors explicitly encourage "the community to integrate this model into more standard music sequencing workflows." ONNX export is feasible since the model is a standard `GPT2LMHeadModel` compatible with HuggingFace's `optimum` export pipeline. MLC-quantized versions already exist at `mlc-ai/mlc-chat-stanford-crfm-music-small-800k-q0f32`.

**Critical caveat**: The AMT does not accept symbolic chord labels. It operates on raw note events with absolute millisecond timing. To condition on `Cmaj7`, you must convert to actual MIDI notes (C4, E4, G4, B4) placed at the correct times. This is straightforward to implement but requires a chord-to-voicing mapping layer.

### Four strong alternatives

**Composer's Assistant v2** (Malandro, 2024, ISMIR) is the only model with a **complete working DAW integration** (REAPER scripts). It uses a T5-like encoder-decoder architecture trained exclusively on **permissively-licensed MIDI**—critical for commercial use. Version 2 adds rhythmic conditioning, note density control, and pitch constraints. It infills arbitrary (track, measure) pairs, supports all 128 MIDI instruments plus drums, and is fully open-source.

**MIDI-GPT** (Pasquier et al., 2025, AAAI) is a compact **~20M parameter** GPT-2-based model already integrated into Cubase and Ableton via the Calliope system. It offers attribute control tokens for instrument type, note density (10 bins), polyphony range, and duration range, inserted per-track before musical content. Its **Bar-Fill** representation—masking bars with `FILL_IN` tokens—is purpose-built for DAW infilling workflows. Trained on the **GigaMIDI** dataset (2.1M+ unique MIDI files).

**SkyTNT MIDI Model** (~250M parameters, Apache-2.0) is notable for having **ONNX models already exported** with KV-cache support in its HuggingFace repository. Multi-instrument generation with drum kit and key signature selection. The lowest-friction path to a working ONNX prototype.

**MusicLang v2** uses a LLaMA-2 architecture with **native chord conditioning** via a `predict_chords("Am CM Dm E7 Am")` API, trained on CC0-licensed Lakh MIDI. Its chord vocabulary supports standard qualities (M, m, 7, m7b5, sus2, sus4, M7, dim) with bass notes. The **GPL-3.0 license** is the main limitation for commercial DAW plugins.

### Model comparison for implementation planning

| Model                   | Params | Chord conditioning | Multi-track     | ONNX ready   | License     | Best for                    |
| ----------------------- | ------ | ------------------ | --------------- | ------------ | ----------- | --------------------------- |
| **AMT (medium)**        | 360M   | Via note controls  | Native          | Exportable   | Apache-2.0  | Accompaniment generation    |
| **Composer's Asst. v2** | ~150M  | Via piano track    | 128 instruments | Exportable   | Open source | DAW infilling               |
| **MIDI-GPT**            | 20M    | Attribute tokens   | Native          | Exportable   | Unclear     | Lightweight, fast inference |
| **SkyTNT**              | ~250M  | Limited            | Native          | Already done | Apache-2.0  | Fastest ONNX prototype      |
| **MusicLang v2**        | Small  | Native string API  | Yes             | Exportable   | GPL-3.0     | Chord-first workflows       |

### MIDI-RWKV deserves attention for edge deployment

A 2025 paper introduces **MIDI-RWKV**, using RWKV-7 (a linear-complexity alternative to transformers) for symbolic music infilling. Its **O(n) complexity** versus transformers' O(n²) means better scaling for long sequences on resource-constrained hardware. It uses MIDI-GPT's Bar-Fill representation. This architecture is worth monitoring as a future upgrade path for lower-end devices.

---

## Rule-based generation as the essential foundation layer

A purely ML-dependent system is fragile—model loading takes time, inference has latency, and GPU availability varies. The recommended architecture uses **rule-based algorithms as the zero-latency foundation**, with ML as an enhancement layer. This mirrors how Band-in-a-Box achieved commercial success with purely algorithmic MIDI generation for nearly two decades before adding RealTracks.

**For bass lines**, a chord-tone walking algorithm is highly effective: play the **root on beat 1**, **fifth on beat 3**, **third or seventh on beat 2** (ascending or descending motion), and a **chromatic approach note on beat 4** (half step above or below the root of the next chord). For pop/rock styles, simpler root-fifth or root-octave patterns with rhythmic variations suffice. These rules produce musically correct output with zero compute, instantly. The MaxHilsdorf Walking-Bass-Generator on GitHub implements this in under 500 lines of Python, trivially portable to Rust.

**For drums**, a probability-grid approach works well: define a 16-step grid per instrument (kick, snare, hi-hat, etc.) where each step has an activation probability and velocity distribution. Genre templates set the base probabilities (four-on-the-floor kick for house, beats 2 and 4 snare for rock). **Euclidean rhythms** (Bjorklund algorithm, ~30 lines of code) distribute k onsets across n steps as evenly as possible, producing patterns that map to real-world rhythms: E(3,8) is the Cuban tresillo, E(5,8) is the cinquillo, E(5,16) approximates bossa nova.

**For keyboard voicings**, rule-based voice leading (close voicing, drop-2, drop-3 inversions) combined with common comping patterns per genre produces solid results. Root-position block chords are the simplest starting point; adding rhythmic patterns (whole notes, quarter-note Alberti bass, eighth-note arpeggios) scales complexity with a single parameter.

The critical hybrid opportunity is **GrooVAE** (Google Magenta): a small VAE model specifically trained on the **Groove MIDI Dataset** (13.6 hours, 22,000+ measures from 10 professional drummers, CC BY 4.0). Its **humanization model** takes a quantized drum pattern and outputs an expressive performance with microtiming and velocity variation. The **Tap2Drum model** converts a tapped rhythm into a full drum beat. These are small enough to run locally (~tens of MB) and transform rigid algorithmic output into human-feeling performances. A **rule-generated pattern + GrooVAE humanization** pipeline produces excellent results with minimal compute.

---

## Inference architecture in Rust via Tauri

### ONNX Runtime through the `ort` crate

The **`ort` crate** (884K+ monthly downloads, used by HuggingFace TEI and Google Magika) wraps ONNX Runtime 1.24 with full Rust bindings. It supports execution providers for **CUDA** (NVIDIA), **CoreML** (macOS), **DirectML** (Windows DX12), **TensorRT**, **OpenVINO** (Intel), and experimental **WebGPU**. The `Session` type is `Send + Sync`, safe to share across threads without a Mutex for read-only inference.

For autoregressive token generation—which music transformers require—the main challenge is **KV-cache management**. The ONNX model must be exported with explicit key-value cache I/O tensors. Each forward pass takes the latest token plus cached attention state and outputs logits plus updated cache. Without caching, generating 100 tokens costs O(n²); with caching, O(n) per token—roughly **50× faster**. For a 360M-parameter music transformer, KV cache consumes approximately **50–200MB** of memory.

The recommended Tauri architecture uses **`tokio::spawn_blocking`** to run the inference loop on a dedicated thread, preventing UI freezes. Model state is managed via `Arc<ModelState>` registered with `app.manage()`. Generated MIDI events stream to the React frontend via **Tauri v2 Channels** (preferred over events for ordered, high-throughput IPC):

```rust
#[tauri::command]
async fn generate_midi(
    channel: Channel<MidiChunkPayload>,
    state: tauri::State<'_, Arc<MlState>>,
    chord_tokens: Vec<i64>,
    params: GenerationParams,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Autoregressive loop with KV cache
        // Emit chunks via channel.send() every 8 tokens
    }).await
}
```

On the frontend, `invoke('generate_midi', { ... })` triggers generation while `listen('midi_chunk')` receives streaming partial results for real-time piano roll updates.

### Candle over mistral.rs for custom architectures

**mistral.rs** only supports standard LLM architectures (Llama, Mistral, Phi, Qwen). A purpose-built music transformer with relative attention or custom tokenization **will not work** with mistral.rs. The correct alternative is **Candle** (HuggingFace's Rust ML framework), which mistral.rs is built on. Candle provides a PyTorch-like API with GPU support (CUDA + Metal), safetensors weight loading, and WASM compilation. A custom `MusicTransformer` struct implementing the model architecture can load weights from any PyTorch checkpoint. Music models at 20–360M parameters need **well under 1GB at FP16**, negligible compared to LLMs.

### Latency expectations for 4–8 bars of MIDI

Four bars of music in REMI tokenization produce approximately **200–600 tokens** depending on note density. Expected generation times:

- **CPU (Apple M3 Max / Intel i9)**: 2–8 seconds — acceptable for non-realtime "generate" button
- **CUDA (RTX 3060+)**: 0.3–1.5 seconds — good for interactive use
- **CoreML (M-series)**: 0.5–2 seconds — good for interactive use
- **WebGPU (browser)**: 1–5 seconds — variable, fallback only

With streaming decoding, **first notes appear in ~50–200ms** as REMI tokens can be decoded incrementally (notes are emitted upon receiving a Duration token). This enables real-time piano roll population during generation.

### WebGPU inference as an optional fallback

ONNX Runtime Web with WebGPU delivers **19× speedup over WASM** for encoder models, with FP16 support since Chrome 121. However, in a Tauri app, WebGPU availability depends on the webview: full support on **Windows** (WebView2/Chromium), expected late 2025 on **macOS** (Safari/WebKit), and unavailable on **Linux** (WebKitGTK). The recommendation is **native inference via `ort` as primary, WebGPU as an optional browser-side fallback on Windows only**.

---

## Encoding the chord track and musical context

The encoding pipeline transforms DAW state (chord symbols, tempo, time signature, user parameters) into model-compatible token sequences. Two dominant approaches exist, each suited to different model families.

### REMI tokenization for bar-position models

REMI (Huang & Yang, 2020) provides a **metrical grid** encoding: `Bar` tokens mark measure boundaries, `Position` tokens indicate subdivisions within a bar (e.g., 32 positions at 8 per beat in 4/4), and notes are triplets of `Pitch → Velocity → Duration`. Chords, tempo, and time signatures are placed at Position markers. The MidiTok library implements REMI, REMI+, Compound Word, and 8+ other schemes with a consistent Python API backed by **Symusic** (Rust-based MIDI I/O).

A `Cmaj7 → Dm7 → G7 → Cmaj7` progression in REMI+ looks like:

```
Bar_None → Position_0 → Tempo_120.0 → Chord_C:7maj → Program_33 →
  Pitch_48 → Velocity_80 → Duration_1.0.8
Bar_None → Position_0 → Chord_D:7min → Program_33 →
  Pitch_50 → Velocity_78 → Duration_1.0.8
Bar_None → Position_0 → Chord_G:7dom → Program_33 →
  Pitch_43 → Velocity_82 → Duration_1.0.8
Bar_None → Position_0 → Chord_C:7maj → Program_33 →
  Pitch_48 → Velocity_80 → Duration_2.0.8
```

**MidiTok's default chord vocabulary** covers 12 roots × 14 qualities = **168 chord tokens** (maj, min, dim, aug, sus2, sus4, 7dom, 7maj, 7min, 7dim, 7halfdim, 7aug, 9maj, 9min). For jazz extensions (7sus4, 13dom, add9), custom entries are trivially added to the `chord_maps` dictionary. Chord changes at arbitrary positions within a bar are natively supported—simply place a new Chord token at any Position.

### Arrival-time encoding for the Anticipatory Music Transformer

The AMT uses a fundamentally different scheme: each note is a triplet of **(onset_time, duration, note)** where time is absolute milliseconds at 10ms resolution and `note = 128 × instrument + pitch`. There are no Bar, Position, or symbolic Chord tokens. The vocabulary is ~27,512 tokens, doubled to ~55,000 to distinguish generated events from control events.

To condition on chords, you must **convert chord symbols to actual MIDI note voicings**. The pipeline is: `Cmaj7` → `[C3, E3, G3, B3]` at the appropriate onset times → tokenize as control events → interleave with the generation sequence using the anticipation mechanism (δ = 5 seconds lookahead). This requires a chord-to-voicing module that handles inversions, voice leading, and register constraints—a straightforward rule-based component.

### Mapping UI parameters to model conditioning

Each user control maps to a specific encoding strategy:

**Complexity** (0.0–1.0) maps to **note density bins**. MIDI-GPT defines 10 per-instrument percentile bins, so `complexity × 10` selects the appropriate bin. Alternatively, for rule-based generation, complexity directly controls the number of notes per beat and rhythmic subdivision level.

**Intensity** (0.0–1.0) maps to **velocity range tokens** plus density modifiers. Higher intensity means louder dynamics (velocity bins) and more notes. For the AMT, this translates to higher pitch values in the note token encoding.

**Swing** (0–100%) is best handled as **post-processing**: generate on a straight quantization grid, then apply a deterministic timing offset to upbeat positions. No current model natively handles swing feel well. The offset formula is `upbeat_shift = swing_pct × triplet_offset`.

**Genre/Style** maps to either **attribute prefix tokens** (MIDI-GPT, MuseCoco) or model/checkpoint selection (genre-specific fine-tuned weights). For a rule-based layer, genre selects the pattern template library (rock, jazz, electronic, etc.).

**Temperature** controls sampling randomness during autoregressive generation. Lower values (0.7) produce conservative, predictable output; higher values (1.2) introduce creative variation. This is a pure inference parameter, not a token.

The FIGARO model (von Rütte et al., 2023) demonstrates the most comprehensive description-based conditioning: per-bar tokens specifying time signature, active instruments, chord, note density, mean pitch, mean velocity, and mean duration. This architecture allows bar-level control over all musical parameters and represents the upper bound of what conditioning can achieve.

---

## Recommended implementation architecture

The system should be built in three tiers, each independently valuable, with higher tiers adding ML sophistication:

**Tier 1 — Rule engine (zero latency, zero GPU)**. Implement in pure Rust. Walking bass algorithm for bass lines, probability-grid templates for drums, rule-based voicings for keys. All patterns constrained by chord track input. This tier ships on day one and works on every machine. Parameters (Complexity, Intensity, Swing) directly modulate algorithmic behavior. Estimated implementation: 2,000–4,000 lines of Rust.

**Tier 2 — Small model enhancement (GrooVAE, ~50MB)**. Add GrooVAE humanization via ONNX to transform rigid Tier 1 drum patterns into expressive performances. Also add MusicVAE's small drum/bass models for variation generation and latent space interpolation. These models are small enough to load alongside the DAW with negligible memory impact. Run via `ort` on CPU in under 100ms per 2-bar pattern.

**Tier 3 — Transformer accompaniment (AMT 128M–360M, 0.5–3GB)**. Full neural accompaniment generation via the Anticipatory Music Transformer or MIDI-GPT. Load on demand when the user requests AI generation. Provide chord track as control events, user parameters as sampling configuration, and stream generated tokens back to the frontend via Tauri Channels. Target: 4 bars in under 3 seconds on GPU, under 8 seconds on CPU. The 128M model is the recommended starting point for balance of quality and performance; upgrade to 360M for users with dedicated GPUs.

For the ONNX export pipeline: convert the AMT's HuggingFace checkpoint using `optimum-cli export onnx` with KV-cache support enabled. For the tokenization pipeline, port MidiTok's REMI decoder to Rust as a simple state machine (~300 lines) for token-to-MIDI conversion, and implement the arrival-time encoder for AMT input preparation. Use the **`midly`** crate (202K downloads) for MIDI file I/O in Rust.

## Conclusion

The gap between Logic Pro's Session Players and what open-source models can achieve has narrowed dramatically since 2023. The Anticipatory Music Transformer's infilling mechanism solves the core technical challenge—generating instrument-specific parts conditioned on existing musical context—with a permissive license and feasible model sizes. But the most important architectural insight is that **ML should augment, not replace, rule-based generation**. Band-in-a-Box proved that algorithmic chord-to-MIDI generation achieves commercial quality, and GrooVAE proved that ML humanization transforms rigid patterns into convincing performances. A tiered architecture delivers instant results from rules, enhanced by neural expressiveness when compute is available, while keeping all inference local and all data private. The critical next step is prototyping Tier 1 (rule engine + Rust) and Tier 3 (AMT ONNX export + `ort` integration) in parallel, since they are architecturally independent and together validate the full pipeline from chord track to generated MIDI.
