# AI in music production: a comprehensive guide for building a DAW

**The most impactful AI features for a professional DAW are not generative — they're assistive.** Survey data from 2025–2026 consistently shows that **87% of producers use AI somewhere in their workflow**, but adoption clusters overwhelmingly around audio restoration (58%), mixing assistants (38%), and mastering services (34%), while composition tools trail at just 21%. The tools producers actually rely on daily — iZotope Ozone's Master Assistant, Demucs-based stem separation, Gullfoss intelligent EQ — share a common UX philosophy: **they guide without deciding, show their work, and keep the human in creative control**. For a React/TypeScript/Tauri v2 DAW, this means prioritizing assistive AI that accelerates technical tasks while preserving creative friction, using ONNX Runtime via the `ort` crate for local inference, and adopting UI patterns proven across the best tools in the ecosystem.

---

## The AI tools producers actually use vs. talk about

The gap between AI hype and AI adoption in music production is stark. A Tracklib survey of 1,107 producers found that among those using AI, **73.9% use it for stem separation**, 45.5% for mastering/EQ plugins, and only 3% to create entire songs. Nearly 75% of AI-using producers use only free tools. The LANDR 2025 study (1,241 respondents) confirms that while 87% use AI somewhere, most treat it as one would "a band of session musicians" — filling gaps, not replacing creative judgment.

**Tools with genuine daily adoption:**

- **iZotope Ozone/Neutron** — the gold standard for AI-assisted mixing and mastering. GRAMMY-winning engineer Joe Visciano calls the Master Assistant "an incredibly useful way to gain a fresh perspective after a full day of mixing." The key: it shows every module and setting it chose, making it a learning tool.
- **Demucs/Moises/LALAL.AI** — stem separation is the single most universally praised AI application. Demucs v4 achieves **9.2 dB SDR** on benchmarks, roughly doubling perceived quality over Spleeter. Moises has **65M+ users** and won Apple's iPad App of the Year.
- **Soundtheory Gullfoss** — an intelligent EQ based on computational auditory perception, not ML. TapeOp: "Never has a plug-in entered my workflow as quickly and permanently as Gullfoss." Its five-parameter interface processes the spectrum **300+ times per second**.
- **Sonible smart:EQ 4** — AI-powered spectral balancing with cross-channel unmasking. Grammy-winning producer Byrd: "Whenever a sound isn't sitting right in the mix, smart:EQ 4 usually solves it in seconds."
- **Neural Amp Modeler (NAM)** — open-source amp modeling with **90,000+ community models** and **1.3M+ downloads** on TONE3000. Captures match source amps with over 99% accuracy.

**Tools producers talk about but rarely use in final production:**

- **Suno** (100M+ signups, ~7M songs/day) is used by professionals as a brainstorming tool — Recording Academy CEO Harvey Mason Jr. confirms "every songwriter and producer I know has used it now" — but outputs go into the DAW for reworking, not straight to release. Suno's $2.45B valuation reflects consumer scale, not professional adoption.
- **Udio** had technical superiority but **disabled all downloads** in 2025 as part of UMG licensing settlements, effectively killing professional use.
- **AudioCraft/MusicGen** (Meta) is discussed in developer circles but requires **16GB+ VRAM** and produces only instrumentals — too heavy and limited for most producers.
- **Emergent Drums** generates novel drum samples but kicks trend "crunchy, digitally lo-fi" — better for experimental genres than mainstream production.

The Sonarworks/Sound On Sound 2026 survey of 1,100+ working producers crystallizes the divide: "Producers make a clear distinction between tools that assist with labor-intensive technical tasks and those that attempt to automate creative decision-making." Tools that handle the former get adopted; tools that attempt the latter face skepticism.

---

## Ranked AI features to implement, with integration paths

Based on adoption data, producer sentiment, technical feasibility, and impact on workflow, here are the AI features ranked by implementation priority for a Tauri v2 DAW.

### Tier 1 — High impact, proven demand, technically feasible

**1. Stem separation (Demucs v4)**
The single most requested and used AI feature across all surveys. Separates vocals, drums, bass, and other instruments from any audio clip. In a DAW context, this enables remixing, rebalancing, isolating elements for processing, and creative sampling.

_Integration path:_ Download the HTDemucs ONNX model (~85MB) on first use, store in app data directory. Run inference via `ort` crate with `load-dynamic` feature on a background Tokio thread. GPU acceleration via CUDA/DirectML/CoreML when available, CPU fallback (~5 minutes per 3-minute song on CPU, ~5 seconds on GPU). Emit progress via Tauri events. The GSOC 2025 Mixxx project created a fully self-contained ONNX export with internalized STFT operations. Reference implementations: `sevagh/demucs.onnx` (C++), `gianlourbano/demucs-onnx` (WebGPU).

_UI pattern:_ Follow Ableton's approach — right-click any audio clip → "Separate Stems." Results appear as new tracks in a folder beneath the source. No modal dialog. Show a non-blocking progress indicator in the status bar. Once complete, each stem gets its own waveform, volume, and mute/solo controls. This is how Logic Pro, Ableton, FL Studio, and Cubase all implement it — inline, non-intrusive, treated as normal audio.

**2. Audio-to-MIDI conversion (Basic Pitch)**
Spotify's Basic Pitch is extraordinary for its ratio of quality to size: **under 17K parameters, under 20MB peak memory**, and it runs **faster than real-time** on any modern CPU. Polyphonic, instrument-agnostic, with pitch bend detection. Apache 2.0 license.

_Integration path:_ Bundle the ONNX model (~3-5MB) directly with the app — small enough to include in the installer. The `ort` crate handles inference trivially. A C++ port exists (`sevagh/basicpitch.cpp`) with ONNX Runtime, and a working VST plugin (`DamRsn/NeuralNote`) demonstrates DAW integration. A TypeScript npm package (`spotify/basic-pitch-ts`) exists for frontend prototyping.

_UI pattern:_ Right-click any audio region → "Convert to MIDI." Place the resulting MIDI clip on a new instrument track directly below the audio. This mirrors Logic Pro's "Extract Notes" and Fender Studio Pro 8's audio-to-note conversion — single-click operations from the timeline.

**3. Intelligent spectral analysis and visualization**
Beat detection, key detection, BPM analysis, and spectrum visualization are expected features in modern DAWs and can be implemented in **pure Rust** without ML models. These algorithms (autocorrelation-based beat tracking, chroma features via FFT, Krumhansl-Schmuckler key profiles) are well-documented DSP operations.

_Integration path:_ Use `rustfft` (6.4, 13.5M downloads) and `realfft` (3.5, 7.3M downloads) for FFT operations. Implement onset detection, beat tracking, and chroma extraction as pure Rust functions. For pitch detection requiring ML, bundle CREPE tiny (~600KB ONNX model) for real-time frame-by-frame pitch tracking at ~10-20ms latency. Key detection needs ~1-2 seconds of audio context.

_UI pattern:_ Always-visible — BPM and key displayed in the transport bar (auto-detected on import). Spectrum analyzer available as a toggleable overlay on any track. This is baseline expectation, not a differentiator.

**4. Reference-based mastering/matching**
Reference-track matching is the most trusted form of AI processing because **the producer makes the creative decision** (choosing the reference) while AI handles technical execution. The Matchering algorithm matches RMS, frequency response, peak amplitude, and stereo width.

_Integration path:_ Matchering is GPLv3 (problematic for proprietary software), but the core algorithm is DSP-based (not neural network) — implement the matching logic in pure Rust using `rustfft` for spectral analysis and custom DSP for RMS/dynamics matching. This avoids the GPL issue entirely. The algorithm: (1) compute spectral envelope of reference and target via FFT, (2) design matching EQ filter, (3) match RMS/dynamics, (4) apply transparent limiting.

_UI pattern:_ Follow iZotope Ozone's pattern — drag a reference file into a "Reference" slot, then the system displays your audio's spectrum against the reference target as a real-time overlay (blue tunnel = reference range, white line = your audio). Provide a single **intensity slider** (0-100%) controlling how aggressively the match is applied. Always show before/after with gain-matched bypass.

### Tier 2 — Medium effort, high value, differentiating

**5. AI-assisted EQ with "learn" pattern**
The Sonible smart:EQ 4 "learn" button pattern — press record, AI analyzes the signal, generates a corrective EQ curve — is well-proven and trusted by producers. Combine with cross-channel unmasking (detecting and resolving frequency conflicts between tracks).

_Integration path:_ The spectral analysis can be implemented in pure Rust (FFT → spectral envelope → comparison against genre-specific target curves). For the "smart" part, store a library of spectral profiles per instrument/genre (JSON data, not ML models). The AI curve generation is essentially: analyze current spectrum → compare to target profile → generate corrective EQ nodes. Cross-channel unmasking: compare spectra of two tracks, identify overlapping energy peaks, suggest complementary cuts.

_UI pattern:_ Each EQ instance gets a **"Learn" button**. Press it, play audio for 4-8 seconds, and the AI generates a corrective curve shown in green overlaid on the spectrum display. The curve is fully editable — users can drag individual nodes, adjust intensity via a slider, or dismiss entirely. For cross-channel work, follow smart:EQ 4's **Group View** pattern: drag-and-drop tracks into Front/Middle/Background priority lanes, and the system automatically suggests complementary EQ adjustments.

**6. Pitch detection and correction**
Real-time pitch detection (CREPE) combined with corrective processing. This is a core vocal production feature.

_Integration path:_ CREPE tiny (600KB) runs in real-time at ~10-20ms per frame via `ort`. For pitch correction, implement the standard algorithm: detect pitch → compute deviation from nearest scale degree → apply pitch shift via phase vocoder or PSOLA synthesis. The `nnnoiseless` crate (Rust port of RNNoise) handles noise suppression as a complementary feature.

_UI pattern:_ Inline in the piano roll / audio editor — show detected pitch as a curve overlaid on the waveform, with the target scale degrees as horizontal grid lines. A **correction strength** slider (0-100%) controls how aggressively notes snap to the grid. This mirrors Melodyne's approach but simplified.

**7. Intelligent gain staging and loudness management**
Auto-gain, loudness targeting (LUFS), and dynamic range analysis. Every major DAW now includes this.

_Integration path:_ Pure Rust DSP. Implement EBU R128 loudness measurement, true peak detection, and auto-gain compensation. These are straightforward signal processing operations using `realfft` for spectral analysis.

### Tier 3 — Advanced, experimental, or cloud-dependent

**8. AI MIDI generation/completion**
Small transformer models can generate or continue MIDI sequences. Google's Magenta models (MusicRNN, MusicVAE) are available, though ONNX conversion is non-trivial. The Hooktheory Aria approach — using a transformer fine-tuned on a chord progression database — produces musically coherent results.

_Integration path:_ Explore the `candle` crate (Hugging Face, 16K+ GitHub stars) for native Rust transformer inference, or use `ort` with a small ONNX-exported sequence model. Model size should be under 100MB for bundling. Alternatively, provide an API integration point for cloud-based generation (user brings their own API key for Claude/GPT/etc., similar to the MIDI Agent plugin pattern).

_UI pattern:_ In the MIDI editor, select a region → right-click → "Generate Continuation" or "Suggest Chords." Show suggestions as **ghost notes** (semi-transparent, like GitHub Copilot's ghost text) that the user can accept with Tab/Enter or dismiss with Escape. The Ableton Magenta Studio pattern works well: generate → audition → accept/regenerate.

**9. Full audio generation (MusicGen/Stable Audio)**
Text-to-audio generation is technically impressive but requires massive GPU resources (MusicGen-small is 1.2GB, medium is 6GB) and produces only instrumentals. Generation takes minutes even on GPU.

_Integration path:_ Do **not** bundle these models. Instead, provide a plugin architecture or API integration point. Users who want this can connect to cloud services or download models on demand. The `ort` crate supports loading arbitrary ONNX models, so the architecture just needs a generic "run model" pipeline.

_UI pattern:_ If implemented, use a dedicated panel (not inline) with a text prompt field, generation progress bar, and the result appearing as a new audio clip that can be dragged into the timeline. Follow Suno's iteration pattern: generate → preview → "Generate Variation" → accept.

---

## UI/UX patterns that work, with concrete specifications

### The trust formula: transparency + control + relevance + reversibility

Research across all major AI music tools reveals a consistent pattern: **producers adopt AI tools that satisfy four conditions simultaneously**. The Sonarworks 2026 survey found that 77% of producers fear loss of originality as their top concern — trust is the bottleneck, not capability.

**Transparency — "Show your work"**
iZotope Ozone is the benchmark. When the Master Assistant creates a processing chain, it shows every module selected, every parameter value, and lets users solo/bypass each stage. iZotope explicitly positions this as educational: "By inspecting the modules and settings used, you can start to learn what types of processing benefit your music."

_Concrete specification:_ Every AI action in the DAW should produce a visible, inspectable result. If AI applies EQ, show the EQ curve. If AI adjusts levels, show the gain changes numerically. If AI generates MIDI, show the notes. Never apply processing without visual representation of what changed.

**Control — "I can always override"**
The progressive disclosure pattern from Ozone 12 works best: three tiers of control depth. (1) **Macro view** — single intensity slider, accept/reject. (2) **Module view** — individual parameters for each processing stage. (3) **Full edit** — complete manual control, AI suggestions become starting points.

_Concrete specification:_ Every AI suggestion must be: (a) previewable before committing, (b) adjustable via at least an intensity slider, (c) fully editable at the parameter level, (d) dismissable with one click. The pattern is: **AI suggests → user previews → user adjusts → user commits or rejects**.

**Relevance — "It understands my context"**
The biggest complaint about Ozone's Assistant is insufficient genre granularity: "The mix requirements of a deep house track will be vastly different to drum and bass, but both fall under the setting for EDM." Ozone 12 expanded to 25+ genre targets, and smart:EQ 4 added 22 genre-based Mix Profiles, responding directly to this feedback.

_Concrete specification:_ AI features should be context-aware. Detect or let the user specify genre/style. Use reference tracks as the primary mechanism for defining sonic targets — this converts AI from an "opinion-giver" into a "precision tool" executing the producer's aesthetic intention.

**Reversibility — "I can always undo"**
Non-negotiable. An arXiv study on AI-assisted music production specifically recommends "support for iterative re-generation" and "DAW integration" as the most important features. Every AI operation must integrate with the standard undo system.

_Concrete specification:_ All AI operations create undoable entries in the history stack. For destructive operations (stem separation, audio generation), create new clips/tracks rather than modifying originals. For non-destructive operations (EQ suggestions, MIDI generation), use a "suggestion layer" that can be committed or discarded.

### Before/after comparison is mandatory

Every AI processing feature needs gain-matched A/B comparison. This is critical because louder audio always sounds subjectively "better" due to psychoacoustic bias — without level matching, users can't honestly evaluate whether the AI improved their audio.

_Concrete specification:_ A global bypass toggle with automatic gain compensation. When the user toggles between processed and unprocessed, levels match within ±0.5 dB. Ozone, LANDR, and Gullfoss all implement this. The button should be prominent and accessible via keyboard shortcut.

### The intensity slider as universal "how much AI" control

This pattern appears across nearly every successful AI music tool: a single slider controlling the blend between unprocessed and fully processed audio. LANDR uses processing "styles" with per-parameter knobs. Sonible uses an "Adaptive" parameter. Adobe Podcast added a strength slider (0-100%) after users complained that 100% enhancement sounded "unnaturally perfect."

_Concrete specification:_ Every AI feature gets a **Strength/Intensity** parameter (0-100%). At 0%, audio is unaffected. At 100%, the full AI suggestion is applied. Default to **60-70%** — multiple reviews note that AI tools are "too aggressive by default" (Gearspace: "over EQ'd, way too bright, over enveloped, and over cooked in the limiter"). Conservative defaults build trust.

### The "learn" button pattern

Sonible smart:EQ 4's pattern is the cleanest implementation: select a profile → press a "Learn" button → AI analyzes during playback → generates result. This single interaction pattern works for EQ, mastering, dynamics, and any spectral processing task.

_Concrete specification:_ The learn button should: (1) clearly indicate "listening" state with animation, (2) require minimum 4 seconds of audio (configurable up to 30 seconds), (3) automatically select the loudest/most representative section if user doesn't specify, (4) generate results in under 2 seconds after analysis completes. Post-learning, the result appears immediately but is not committed until user confirms.

### Where AI belongs in the DAW UI

Research across Ableton, Logic, FL Studio, and others reveals a clear pattern: **no major DAW visually differentiates AI-generated content from user-created content**. AI outputs appear as standard MIDI/audio regions. The trend is toward AI as invisible infrastructure rather than a visible separate feature.

_Concrete specification:_

- **Always visible:** BPM/key detection in transport bar, spectrum analyzer toggle, loudness metering
- **One-click accessible (right-click context menus):** Stem separation, audio-to-MIDI, pitch correction, EQ learn
- **Dedicated panel (toggleable sidebar):** AI mastering assistant, reference matching, cross-channel analysis
- **Command palette (Cmd+K):** Natural language queries for AI features — "separate stems," "detect key," "match to reference." FL Studio's Gopher chatbot proves this works: "Unlike so many virtual website assistants, actually does help you."
- **Not a separate mode or window:** AI features should be accessible from existing UI surfaces. Apple's Logic Pro is the model — Session Players are indistinguishable from other track types, all processing runs locally, and there's no "AI" branding in the UI.

### Ghost clips for AI suggestions

For MIDI generation and audio suggestions, use semi-transparent "ghost" representations — similar to GitHub Copilot's ghost text but applied to audio/MIDI clips.

_Concrete specification:_ AI-generated suggestions appear as clips with 40% opacity, a subtle colored border (e.g., blue), and a small AI indicator icon. Users accept with Enter/double-click (opacity goes to 100%, border removed) or dismiss with Escape/click-away. Ghost clips play on hover for quick audition. This preserves the "suggestion, not decision" principle.

---

## Patterns that fail and what to avoid

### Black box processing with no explanation

When users can't see what the AI did, they don't trust it. A Gearspace user asked: "For seeing what steps the AI assistant does, are there any better alternatives?" Online upload-and-download mastering services receive consistent criticism precisely because they offer no visibility.

_What to avoid:_ Never apply AI processing without showing the result visually. If AI adjusts EQ, show the curve. If AI adjusts dynamics, show the gain reduction. Even Adobe Podcast — the most "magic button" tool in the ecosystem — added a strength slider after V2 complaints about over-processing.

### Aggressive defaults

Multiple reviews of Ozone's Assistant criticize it for being "too heavy-handed" out of the box. MusicTech noted that "where previous versions were a little safe, iZotope has let the shackles off in version 10... the Maximizer teeters close to distortion." Gearspace: "The results were over EQ'd (way too bright), over enveloped, and over cooked in the limiter."

_What to avoid:_ Default AI intensity to 60-70%, not 100%. Let users increase aggressiveness rather than forcing them to dial it back. Conservative defaults build trust; aggressive defaults destroy it.

### AI that interrupts creative flow

The Amplify Partners analysis identifies the core problem: "Most creative AI tools flatten the creative process. They're the equivalent of a band discarding an entire song because the first run-through wasn't perfect." Regeneration-based tools that require starting over with each change fundamentally conflict with the iterative nature of music production.

_What to avoid:_ Never force users into an AI workflow. All AI features should be optional enhancements accessible from existing UI surfaces, not separate modes that interrupt the creative flow. AI should work within the existing session/arrangement paradigm, not create parallel workflows.

### Credit/token anxiety

Suno and Udio users consistently complain about credit systems creating anxiety: "You keep tweaking a few words, hoping the output changes in the direction you want." Credits that don't roll over, generation limits, and pay-per-use models make experimentation feel costly rather than playful.

_What to avoid:_ Since this is a local desktop application, all bundled AI features should be unlimited. No credits, no tokens, no per-use limits. Users paid for the software; the AI features should work as many times as needed.

### Vendor lock-in of AI content

Udio's download lockout devastated its user base: "Thousands of creators who had spent months 'sculpting' their sound were suddenly locked out of their own work." Suno Personas can't be exported. This is a fundamental trust violation.

_What to avoid:_ All AI-generated content must be standard audio/MIDI files that the user fully owns. No proprietary formats, no cloud dependencies for accessing created content, no restrictions on export.

---

## The creative friction principle

The most nuanced finding from this research is that **removing friction isn't always good**. A generative music tools founder told Amplify Partners' Sarah Catanzaro: "Music creation should remain frictionful and tactile." He understood that "when creative effort is removed, value is removed. Art improves when the artist must push against the tool."

MIT Technology Review quotes Elisa Giaccardi (Polytechnic University of Milan): "How can we make art without friction? How can we engage in a truly creative process without material that pushes back?" And Jeba Rezwana (Towson University): "If I ask the AI to create something for me, that's not me being creative. It's a one-shot interaction."

The practical implication for DAW design: **AI should remove technical friction while preserving creative friction.**

- **Remove:** Stem separation latency, manual spectral analysis, tedious gain staging, format conversion, metadata tagging, audio-to-MIDI transcription
- **Preserve:** Arrangement decisions, sound selection, emotional arc, mixing aesthetics, artistic direction

The Sonarworks 2026 survey captures this precisely: "Unlike earlier tools, AI increasingly makes decisions rather than simply executing them. It doesn't just record or process sound; it analyzes, predicts, and chooses. That shift — from tool to collaborator — explains much of the unease." The tools earning permanent adoption handle technical work and stop where creative decisions start.

---

## How the best DAWs integrate AI today

**Apple Logic Pro 12** is the most aggressive AI integrator among traditional DAWs, and its approach is instructive. Session Players (Drummer, Bass Player, Keyboard Player, Synth Player) generate accompaniment that follows the Chord Track, but they appear as standard tracks — no "AI" branding, no separate mode. Chord ID analyzes audio and populates the Chord Track with one control-click. Stem Splitter separates into 6 stems (vocals, drums, bass, guitar, piano, other) via right-click. **All processing runs locally on Apple Silicon.** CDM noted: "These features remain beginner-friendly without sacrificing direct control. All of this happens locally on your machine."

**Ableton Live 12** takes the most conservative approach. Sound Similarity Search (ML-based sample matching) is integrated into the existing browser sidebar. Stem Separation (partnered with Music AI/Moises) operates via right-click on audio clips. No dedicated AI panel, no AI branding. A job posting for "Senior ML Research Engineer" suggests future work, but Ableton's philosophy is clear: AI should "work unobtrusively in the background rather than taking center stage."

**FL Studio 2025** uniquely added a conversational AI assistant called Gopher — the only major DAW with an in-DAW chatbot. Trained on FL Studio's reference manual, it "provides instant answers to any music production query without the user ever having to leave the DAW." MusicTech called it "exponentially more useful" than typical chatbots. Loop Starter generates genre-based loops in the Channel Rack.

**Bitwig Studio 6** (March 2026) deliberately ships **zero AI features**, focusing entirely on workflow fundamentals. This is a valid position — the 9/10 MusicTech review called it "heaven for sound design" — and demonstrates that AI is not yet a requirement for DAW credibility.

The key insight: **no major DAW visually differentiates AI-generated content from user-created content.** AI outputs become standard regions in the timeline. The most successful integrations feel like natural extensions of existing tools, not bolted-on features.

---

## Open source toolkit and Rust/ONNX integration architecture

### The recommended technical stack

```toml
[dependencies]
# Core Tauri v2
tauri = { version = "2", features = ["events"] }

# Audio Processing
cpal = "0.15"              # Cross-platform audio I/O (ALSA, WASAPI, CoreAudio, JACK)
symphonia = { version = "0.5", features = ["mp3", "flac", "wav", "aac"] }  # Audio decoding
rubato = "0.15"            # Sample rate conversion
dasp = { version = "0.11", features = ["all"] }  # DSP primitives
rustfft = "6.4"            # FFT (13.5M downloads, pure Rust)
realfft = "3.5"            # Real-valued FFT (2x faster for audio)
hound = "3.5"              # WAV I/O

# ML Inference
ort = { version = "2.0.0-rc.12", features = ["load-dynamic"] }  # ONNX Runtime

# Async
tokio = { version = "1", features = ["full"] }
```

The `ort` crate (v2.0.0-rc.12, wrapping ONNX Runtime 1.24) is production-ready with excellent documentation at ort.pyke.io. The `load-dynamic` feature is heavily recommended — it loads ONNX Runtime at runtime via `dlopen()`, avoiding shared library conflicts. Bundle `libonnxruntime.dylib/.so/.dll` (~50-150MB) with the Tauri app.

Alternative inference backends worth monitoring: **tract** (Sonos, MIT/Apache-2.0, pure Rust, no C dependencies — excellent for small models but no GPU), **candle** (Hugging Face, 16K stars, supports CUDA + Metal + WASM), and **burn** (tracel-ai, can import ONNX models to native Rust code at compile time with WGPU GPU backend).

### Model bundling strategy

| Model                | Size    | Bundle Strategy         | License       |
| -------------------- | ------- | ----------------------- | ------------- |
| Basic Pitch          | ~3-5 MB | Bundle in installer     | Apache 2.0 ✅ |
| CREPE tiny           | ~600 KB | Bundle in installer     | MIT ✅        |
| CREPE full           | ~30 MB  | Bundle in installer     | MIT ✅        |
| Demucs v4 (HTDemucs) | ~85 MB  | Download on first use   | MIT ✅        |
| MusicGen-small       | ~1.2 GB | Optional cloud/download | CC-BY-NC ⚠️   |

For Demucs, the GSOC 2025 Mixxx project created a fully self-contained ONNX model with internalized STFT operations — this is the cleanest integration path. On Apple Silicon, the MLX port (`andrade0/demucs-mlx`) processes a 3-minute song in ~5.3 seconds (34× real-time).

### Architecture pattern for AI inference in Tauri v2

All AI inference runs on Rust background threads, never blocking the UI. The pattern:

```
React Frontend                    Rust Backend (Tauri v2)
─────────────                    ──────────────────────
invoke("separate_stems")  →     spawn background thread
                                 │ load ONNX model (lazy, cached in app state)
listen("ai-progress")    ←      │ process chunks, emit progress events
listen("ai-complete")    ←      │ emit completion with result paths
```

Models load lazily on first use and persist in app state via `Mutex<Option<ort::Session>>`. Progress reporting uses Tauri events (`app.emit()`). For real-time tasks (pitch detection, FFT), run directly on the audio processing thread. For heavy tasks (stem separation), show a non-blocking progress indicator and process in the background.

### Real-time feasibility matrix

| Task                        | Feasibility              | Typical Latency      | Implementation                            |
| --------------------------- | ------------------------ | -------------------- | ----------------------------------------- |
| Pitch detection (CREPE)     | ✅ Real-time             | ~10-20ms/frame       | ONNX via `ort`, tiny model                |
| Beat/tempo detection        | ✅ Real-time             | ~50-100ms window     | Pure Rust DSP (autocorrelation)           |
| Key detection               | ✅ Near real-time        | ~1-2s full analysis  | Pure Rust (chroma + Krumhansl-Schmuckler) |
| Spectrum/FFT analysis       | ✅ Real-time             | ~5-10ms/frame        | `rustfft`/`realfft`                       |
| Audio-to-MIDI (Basic Pitch) | ⚡ Faster than real-time | ~0.5-2s/song         | ONNX via `ort`, bundled model             |
| Reference mastering         | ⚡ Near-offline          | ~2-5s/track          | Pure Rust DSP                             |
| Stem separation (Demucs)    | ❌ Offline               | GPU: ~5s, CPU: ~5min | Background thread + progress              |
| MIDI generation             | ⚠️ Semi-offline          | ~1-5s for short seq  | Small transformer via `ort` or `candle`   |
| Audio generation (MusicGen) | ❌ Offline only          | Minutes on GPU       | Cloud API or opt-in download              |

---

## Emerging capabilities producers actually want

Forum research across Reddit, KVR Audio, and producer surveys reveals a consistent wishlist. The arXiv study on AI-assisted music production specifically recommends "improving tempo, key, and beat controls, editing capabilities, support for iterative re-generation, and, very importantly, DAW integration."

**What producers are most excited about:**

1. **AI that learns individual preferences over time.** Producer.ai claims "the more you create, the more it understands your sound," but this is still early. Most tools use generic models. Personalization is the most wished-for but least-realized feature.

2. **AI mixing that truly understands genre context.** The gap between "EDM" as a genre setting and the vast differences between deep house, drum and bass, techno, and dubstep is the #1 complaint about existing AI mixing tools. MIDiA Research predicts "AI will be used to help labels define their sound."

3. **Real-time stem separation.** Meta's SAM Audio (December 2025) isolates any sound by text description. iZotope Ozone 12's Stem EQ applies per-stem EQ in real-time during mastering — "an absolute game-changer for mastering engineers." Models have reached "near studio-grade accuracy by 2026."

4. **AI as creative director, not replacement.** The Sonarworks 2026 survey: "Many producers envision their role evolving toward that of a creative director: someone who guides musicians, shapes aesthetic vision, and increasingly directs intelligent tools." The desired model is AI that responds to intent, not AI that generates from nothing.

5. **Ethical transparency about training data.** The Sonarworks survey found that "technical excellence is not enough to earn adoption; ethical transparency determines whether a tool feels acceptable in professional practice." Open-source models with known training data (like Demucs trained on MUSDB18-HQ) have a trust advantage.

---

## Concrete implementation checklist

### Phase 1 — Core assistive AI (ship first)

- [ ] **Stem separation:** Demucs v4 ONNX, background processing, right-click trigger, progress bar, results as folder tracks
- [ ] **Audio-to-MIDI:** Basic Pitch ONNX bundled, right-click trigger, result as MIDI clip on new track
- [ ] **Beat/BPM detection:** Pure Rust DSP, auto-detect on import, display in transport bar
- [ ] **Key detection:** Pure Rust chroma + KS algorithm, auto-detect on import, display in transport bar
- [ ] **Spectrum analyzer:** Pure Rust FFT, toggleable overlay on any track, real-time
- [ ] **Loudness metering:** EBU R128 LUFS measurement, true peak, always visible

### Phase 2 — Intelligent processing

- [ ] **AI EQ with "learn" button:** Spectral analysis → corrective curve generation → editable nodes → intensity slider
- [ ] **Reference matching mastering:** Drop reference → spectral/dynamics matching → intensity slider → gain-matched A/B
- [ ] **Pitch detection and display:** CREPE ONNX, real-time pitch curve overlay in audio editor
- [ ] **Cross-channel unmasking:** Compare spectra between tracks, highlight conflicts, suggest complementary cuts
- [ ] **Auto-gain staging:** Analyze tracks, suggest optimal levels, one-click apply with undo

### Phase 3 — Creative AI

- [ ] **MIDI suggestion/completion:** Ghost note suggestions from small transformer model, accept/reject pattern
- [ ] **AI command palette (Cmd+K):** Natural language interface for triggering any AI feature
- [ ] **Chord detection from audio:** Analyze audio, populate chord track, enable harmonic-aware features
- [ ] **Smart sample search:** ML-based audio similarity for finding related sounds in user library

### What NOT to build (based on producer feedback)

- [ ] ~~Full song generation from text~~ — producers use Suno/Udio as external sketch tools; embedding this creates legal risk and philosophical tension
- [ ] ~~AI that auto-arranges or auto-mixes without asking~~ — violates the "guides, not decides" principle
- [ ] ~~Proprietary AI format lock-in~~ — all outputs must be standard audio/MIDI
- [ ] ~~Credit/token systems for AI features~~ — creates anxiety, not creativity
- [ ] ~~Mandatory AI onboarding or AI-first workflows~~ — AI should be discoverable, not imposed

## Conclusion

The AI music production landscape in 2026 reveals a clear hierarchy of value. **Assistive AI that handles technical drudgery — stem separation, spectral analysis, reference matching, audio-to-MIDI conversion — has achieved near-universal adoption**. Generative AI that attempts creative decisions remains controversial, with only 3% of producers using it for complete songs. The winning UX formula across iZotope Ozone, Sonible smart:EQ 4, Gullfoss, and Logic Pro is consistent: show the work, let users override everything, default to conservative settings, and integrate AI so seamlessly it doesn't feel like AI.

For a Tauri v2 DAW, the optimal path is clear. Start with Demucs stem separation and Basic Pitch audio-to-MIDI — both MIT-licensed, ONNX-ready, and addressing the two most-requested AI features. Implement beat/key detection and spectral analysis in pure Rust — these are baseline expectations, not differentiators. Build the "learn" button pattern for EQ and mastering, powered by DSP algorithms rather than large models. Use the `ort` crate for ONNX inference on background threads with Tauri event-based progress reporting. And above all, follow the creative friction principle: eliminate technical barriers, preserve artistic ones. As the AI Journal put it in 2026: "The tools earning a permanent place in professional workflows are the ones that handle the technical work and stop where creative decisions start."

