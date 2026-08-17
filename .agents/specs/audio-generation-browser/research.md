---
type: research
id: RESEARCH-audio-generation-browser
title: Browser-native AI audio generation feasibility
status: open
owner: The Sourdaw team
sources:
  - Browser-native AI audio generation feasibility study, 2026-Q1
---

# Research: Browser-native AI audio generation feasibility

## Question

Can AI audio generation — instrument synthesis, TTS, and singing voice synthesis — run entirely
client-side in a browser today, and what inference stack, storage backend, model set, and
build order make a shippable feature feasible without a server or sidecar?

## Findings

### R-001 — The 2025–26 browser inference stack is Transformers.js v3 → ONNX Runtime Web → WebGPU

- **Claim:** Transformers.js v3 over ONNX Runtime Web's WebGPU execution provider (with WASM SIMD
  fallback) is the production stack; models up to ~500M params run acceptably before the ~4 GB
  per-tab memory ceiling.
- **Evidence:** ONNX Runtime Web WebGPU EP production-ready since v1.17 (10–15× over WASM);
  Transformers.js v3 serves 1.4M monthly users across 155+ architectures with `{device:'webgpu'}`.
- **Confidence:** high
- **Bears on:** AC-002/AC-003 of the infrastructure spec (worker runtime, EP selection).

### R-002 — WebGPU reaches only ~10–20% of native CUDA; per-dispatch overhead dominates

- **Claim:** WebGPU ML inference runs at ~10–20% of native CUDA, dominated by per-dispatch
  validation (24–71 µs) and compile costs, so batched / graph-captured inference is required and
  per-frame single-tensor dispatches regress badly.
- **Evidence:** measured dispatch overhead; ORT Web graph-capture for static-shape models.
- **Confidence:** high
- **Bears on:** the browser render-time budgets and the no-real-time-AudioWorklet non-goal.

### R-003 — OPFS is the right storage backend; Chrome-only scoping removes fallbacks

- **Claim:** OPFS gives 2–4× faster reads than IndexedDB via synchronous access handles in
  workers and allows ~60% of disk per origin; OPFS is unsupported in Firefox, so a Chrome-only
  scope removes the need for an IndexedDB fallback.
- **Evidence:** OPFS `createSyncAccessHandle` worker API; Firefox OPFS gap.
- **Confidence:** high
- **Bears on:** AC-004 (OPFS storage) and the dropped IndexedDB/Firefox path.

### R-004 — A cache-first Service Worker + Background Fetch is the model-delivery pattern

- **Claim:** Hosting shards on a CDN, intercepting with a cache-first Service Worker, persisting to
  OPFS, reporting via BroadcastChannel, and using Background Fetch for >100 MB downloads is the
  proven delivery pattern; progressive loading (light models first) is essential.
- **Evidence:** web-llm's 108-shard progressive pattern; Background Fetch survives tab navigation
  in Chrome/Edge.
- **Confidence:** high
- **Bears on:** AC-005 (download manager) and the progressive-loading UX.

### R-005 — DDSP is the lowest-risk first feature; it is TF.js-only, not ONNX

- **Claim:** Browser DDSP instrument synthesis (~5–15 MB/instrument, 13 instruments) is the
  highest-impact lowest-risk first feature, but DDSP has no validated ONNX export — TF.js is the
  proven runtime (Google Tone Transfer), forcing a dual-runtime worker design.
- **Evidence:** capability matrix (DDSP score 9, "TF.js native"); no published tf2onnx success for
  DDSP's custom DSP ops.
- **Confidence:** high
- **Bears on:** the DDSP child spec and AC-002 (dual-runtime session manager).

### R-006 — Kokoro-82M is the gold-standard browser TTS

- **Claim:** Kokoro-82M (Apache 2.0, ~160 MB q8) generates 10 s of natural speech in ~1 s on
  WebGPU with 21 voices and is best integrated via Transformers.js v3, not the thin `kokoro-js`.
- **Evidence:** capability matrix (Kokoro score 10); TTS-Arena ranking just behind ElevenLabs.
- **Confidence:** high
- **Bears on:** the Kokoro child spec.

### R-007 — Browser DiffSinger SVS is feasible but the hardest, highest-risk frontier

- **Claim:** No browser-native SVS exists; DiffSinger's ONNX pipeline (~115–160 MB/voice:
  acoustic ~50–80 MB + variance/pitch/linguistic ~15–30 MB + ~50 MB vocoder) is the most viable
  near-term candidate, within the ~500M-param ceiling but at the heavy end, requiring a JS port of
  OpenUtau's tensor-preparation logic and a sequential diffusion loop.
- **Evidence:** capability matrix (DiffSinger score 5) and confirmed voicebank file structure and
  tensor shapes. Browser memory and throughput remain unproven for the full chain.
- **Confidence:** medium
- **Bears on:** the DiffSinger child spec and its descope risk.

### R-008 — Vocoder and voicebank licensing are the gating unknowns for SVS

- **Claim:** Surveyed community vocoders and voicebanks are license- or language-constrained. The
  browser chain cannot ship until every weight has compatible terms and the target languages.
- **Evidence:** the reference vocoder uses a non-commercial ShareAlike license; the best-tested
  voicebank is Chinese-only; no verified compatible English shortlist exists.
- **Confidence:** medium
- **Bears on:** the two blocking open questions on the DiffSinger child spec.

### R-009 — Quantization and distillation, not raw compute, are the sizing levers

- **Claim:** INT8 (q8) gives ~4× size reduction with <1–2% quality loss and is the default;
  INT4 degrades audio (FAD ~3→~7) unless mixed-precision; consistency distillation (steps → 1–2)
  and knowledge distillation (e.g. TinyMusician: 55% smaller, 93% quality) are the future levers
  for shrinking the acoustic model.
- **Evidence:** TinyMusician and ConsistencyTTA/AudioLCM results; ORT quantization modes.
- **Confidence:** high
- **Bears on:** the forward-compatible `quality_tier`/`distillation_origin` registry fields.

## Open questions

- [ ] Q-001 — Does Sourdaw's distribution qualify as NonCommercial under CC-BY-NC-SA 4.0, and is
  ShareAlike compatible with the app code and generated audio? (blocking SVS; human/legal)
- [ ] Q-002 — Which English DiffSinger voicebank ships first under a compatible license? (blocking SVS)
- [ ] Q-003 — Is consistency distillation worth pursuing to cut 30 s renders to ~6 s post-MVP?

## Recommendation

Build the shared `BrowserAi` inference infrastructure (R-001/R-003/R-004) Chrome-only on WebGPU
with a dual-runtime worker (R-005), then ship in three phases: DDSP instruments first via TF.js
(R-005), Kokoro TTS via Transformers.js (R-006), and DiffSinger browser SVS last (R-007), gating
the SVS phase on the vocoder/voicebank licensing determinations (R-008). Favor batched,
graph-captured inference to mitigate WebGPU overhead (R-002), default to q8 quantization, and keep
the registry forward-compatible for distilled and codec-token models (R-009).

---

## Restored from migration (audio-generation-browser pipeline research)

The sections below were dropped when `research/pipelines/audio-generation-browser.md`
(git `bb84b0e`) was summarized into the findings above. They are restored verbatim
(headings demoted one level for nesting) so the detailed evidence — the full Part 2
UI/UX report, both risk registers, the WebGPU 128 MB constraint, and the dropped
capability-matrix candidates — has a home. Source of record:
`git show bb84b0e:research/pipelines/audio-generation-browser.md`.

### Dropped Part 1 capability-matrix candidates (original §2, lines 19-37)

The original §2 scored 15 model candidates. Findings R-005/R-006/R-007 above carry only
DDSP, Kokoro, and DiffSinger. The candidates dropped entirely from the current project research,
restored here verbatim from the original capability matrix:

| #   | Model                       | Category           | Params          | Disk size       | License             | ONNX export            | Browser demo exists      | Browser score (1–10) |
| --- | --------------------------- | ------------------ | --------------- | --------------- | ------------------- | ---------------------- | ------------------------ | -------------------- |
| 2   | **KittenTTS Nano**          | TTS                | 15M             | 25MB (int8)     | Apache 2.0          | ✅ Native ONNX         | ✅ WASM demo             | **9**                |
| 4   | **RAVE.js**                 | Timbre transfer    | ~5–15M          | 4–20MB          | Research            | ✅ ONNX                | ✅ ravejs demo           | **8**                |
| 5   | **MusicGen Small**          | Text→Music         | 300M            | ~1.2GB          | CC-BY-NC 4.0        | ✅ Xenova ONNX         | ✅ musicgen-web          | **7**                |
| 6   | **F5-TTS**                  | Voice cloning      | 335M            | ~700MB          | MIT / CC-BY-NC      | ✅ DakeQQ ONNX         | ✅ nimasarang.com        | **7**                |
| 7   | **EnCodec 24kHz**           | Audio codec        | ~15M            | ~60MB           | MIT                 | Feasible (simple CNNs) | Via Transformers.js      | **7**                |
| 8   | **DAC 44.1kHz**             | Audio codec        | ~70M            | ~280MB          | MIT                 | Feasible (JAX impl)    | No                       | **6**                |
| 9   | **Piper TTS**               | TTS (multilingual) | 15–65M          | 15–100MB        | MIT                 | ✅ Native ONNX         | Partial (espeak blocker) | **6**                |
| 10  | **Matcha-TTS**              | TTS (fast)         | ~20M            | 50–100MB        | MIT                 | ✅ Built-in ONNX       | Via sherpa-onnx WASM     | **6**                |
| 12  | **Chatterbox-Turbo**        | Voice cloning      | 350M            | ~700MB          | Apache 2.0          | ✅ Resemble ONNX       | No                       | **5**                |
| 13  | **So-VITS-SVC**             | Singing conversion | ~110M (+HuBERT) | 400MB+          | AGPL-3.0            | ✅ Export script       | No                       | **4**                |
| 14  | **ACE-Step**                | Music + vocals     | ~500M+          | 2GB+            | Apache 2.0          | No                     | No                       | **2**                |

Also dropped from the original §7 prose: **LFM2.5-Audio** (Liquid AI) — a **1.5B-parameter**
multimodal audio model run in-browser via quantized ONNX + WebGPU, cited as the largest audio
model successfully deployed in a browser context (original line 177).

### Dropped Part 1 §10 risk register — browser deployment (original lines 212-223)

| Risk                                                       | Severity | Likelihood | Mitigation                                                                           |
| ---------------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| **WebGPU not available** (Linux WebKitGTK, older browsers) | High     | Medium     | WASM SIMD fallback; Rust-side inference via Tauri backend                            |
| **Memory exhaustion** with large models (>500M params)     | High     | High       | Aggressive quantization; streaming inference; model sharding                         |
| **128MB storage buffer limit** in Chrome WebGPU            | Medium   | High       | Shard model weights across multiple buffers; use IO binding                          |
| **Audio quality insufficient** for production use          | High     | Medium     | Hybrid architecture: use Rust-side inference for final renders, browser for previews |
| **DiffSinger pipeline reimplementation** complexity        | High     | High       | Start with TTS pipeline (simpler); contribute upstream ONNX improvements             |
| **Model download size** deterring users (>500MB)           | Medium   | Medium     | Progressive loading; preview with smaller models; background downloads               |
| **Cross-browser inconsistency** in WebGPU performance      | Medium   | High       | Test across Chrome/Firefox/Safari; WASM fallback guarantees consistency              |
| **Apple Safari WebGPU limitations** (older macOS)          | Medium   | Medium     | Detect capability; fall back to WASM; document macOS version requirements            |
| **Licensing restrictions** (CC-BY-NC on model weights)     | Medium   | Low        | Prioritize Apache 2.0/MIT models (Kokoro, DDSP, DiffSinger, Piper)                   |
| **Browser tab killed** during long inference               | Low      | Medium     | Web Worker isolation; checkpoint/resume for multi-step diffusion                     |

### Dropped Part 1 WebGPU `maxStorageBufferBindingSize` 128 MB constraint (original line 129)

> Critical limitation: `maxStorageBufferBindingSize` is often capped at **128MB** in Chrome
> despite the GPU reporting higher capabilities, requiring model weight sharding strategies.

Mitigation per the risk register (line 216): shard model weights across multiple buffers and
use IO binding. This is the research basis for the spec's model-weight-sharding requirement.

## Browser-first singing synthesis: achieving AceStudio parity on UI/UX

**The UI/UX challenge is not to invent a radically new interface. It is to combine three patterns that users already understand — DAW arrangement, piano-roll note editing, and AI-assisted direct manipulation — into a browser-first workflow that feels fast, traceable, and safe to experiment with.** The strongest evidence from current singing-synthesis products and broader HCI research points in the same direction: users want familiar editing surfaces, immediate visual feedback, lightweight access to advanced controls, and AI that behaves like a reversible assistant rather than an opaque black box. The best path is not “AI-first UI.” It is **producer-first UI with AI embedded into existing music workflows**.

This report translates that into a full product blueprint for a browser-local singing editor. It covers benchmarked patterns from ACE Studio and Synthesizer V, user feedback from public communities, complex-application UX guidance, and human-AI co-creation research. The conclusion is straightforward: a browser app can compete on usability if it is built around **fast iteration, strong system-status visibility, progressive disclosure, robust keyboard workflows, and traceable AI suggestions**.

---

### 1. Core conclusion

A browser-first singing tool should aim for **DAW familiarity on the surface and AI depth underneath**.

That means:

- **Primary canvas:** arrangement + piano roll, not chat.
- **Primary interaction style:** direct manipulation, not form filling.
- **Primary AI role:** generate, suggest, retake, and explain — never trap the user.
- **Primary trust mechanism:** every AI output must be previewable, comparable, undoable, and attributable to visible controls.
- **Primary performance rule:** the interface must stay interactive even when synthesis is not instant.

The key benchmark products already signal this direction. ACE Studio 2.0 is described as adding “a more DAW-like workflow” and “a DAW-like environment canvas.” Synthesizer V is repeatedly praised for its familiar piano-roll workflow, phoneme editing, and parameter control. Broader UX research reinforces the same pattern: complex creative tools work best when visible objects can be edited directly, system status is always clear, and advanced complexity is layered rather than dumped on screen.

---

### 2. What current products are teaching us

#### ACE Studio’s visible trajectory

ACE Studio’s strongest UI signal is not any single feature. It is the move toward **an all-in-one music workspace**.

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — John Walden, _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

That matters because it suggests where user expectations are heading:

1. A singing tool is no longer judged only as a voice editor.
2. Users increasingly expect arrangement context, audio context, and generation context in one place.
3. Browser-first products should avoid forcing constant mode switches between “editor,” “generator,” and “export tool.”

#### Synthesizer V’s stronger day-to-day workflow signal

Synthesizer V offers the clearest evidence for what producers actually value in daily use.

From the official manual:

> “Synthesizer V Studio allows a combination of automatic pitch generation by AI, direct editing of pitch curves, and manual pitch editing using parameters.”

> “The AI Retakes panel allows you to adjust the amount of variation in the pitch curves generated by the AI.”

> “In Direct Pitch Editing mode, edit the pitch curves directly on the Piano Roll.”

These are not cosmetic details. They point to the winning interaction model:

- AI generates a reasonable default.
- The result is shown in the same editing surface.
- Users can override it directly.
- Variation is managed as a first-class UI concept.

Public user feedback around Synthesizer V reinforces the same pattern.

> “The workflow is improved, the phoneme editing is vastly superior.” — user comment, r/SynthesizerV

> “I love the new mouth opening parameter and the phoneme timing panel, it allows for easier control over the way different words are pronounced.” — user comment, r/SynthesizerV

At the same time, requests from users expose the friction points that still matter:

> “Allow copy-paste of vocal mode settings between groups.”

> “Add shortcuts to nudge selected notes left/right...”

> “Option to lock/unlock group positions in the arrangement to prevent accidental moves.”

> “Often we just want to tweak a note and replay the same section...”

These requests are extremely valuable because they are not abstract UX opinions. They show where expert workflows live or die:

- repeated operations,
- tiny note-level adjustments,
- accidental destructive moves,
- and fast A/B replay of the same musical passage.

#### The practical benchmark

The best competitive target is therefore not “copy AceStudio’s look” or “copy SynthV’s layout.” It is to match the **underlying workflow principles**:

- DAW-like overview at the project level,
- piano-roll precision at the note level,
- curve editing for expression,
- simple default views with deep optional controls,
- and AI retakes that fit into an editing workflow rather than interrupt it.

---

### 3. The most important UX principle: direct manipulation

For this product category, direct manipulation is not a nice-to-have. It is the foundation.

NN/g defines it this way:

> “Direct manipulation is an interaction style in which UI elements are visible and can be acted upon via actions that receive immediate feedback.”

And more specifically:

> “Users act on displayed objects of interest using physical, incremental, and reversible actions whose effects are immediately visible on the screen.”

That maps almost perfectly to singing synthesis editing:

- notes are visible objects,
- pitch curves are visible objects,
- phoneme boundaries are visible objects,
- parameter curves are visible objects,
- and AI changes should appear as visible, reversible deltas.

#### Product implication

The interface should treat **notes, phonemes, curves, retakes, and phrase boundaries as manipulable objects**, not settings buried in dialogs.

The browser UI should therefore prioritize:

- drag note to move pitch/time,
- drag note edge to change duration,
- drag phoneme split handles,
- draw pitch deviation directly over notes,
- draw breath/tension/gender curves inline,
- drag retake options onto a phrase or selected note region,
- audition changes on hover or scrubbing where feasible.

#### Anti-pattern to avoid

Do not turn advanced vocal editing into a stack of sidebar forms. Sidebars are useful for exact values and presets, but the main work should happen on the canvas.

---

### 4. The second principle: visibility of system status

Browser-local singing synthesis has an unavoidable UX problem: generation is not instant. That makes feedback design central.

NN/g’s warning is blunt:

> “The visibility of system status is a basic tenet of a great user experience.”

And for complex applications:

> “The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time.”

Apple’s guidance on progress indicators is equally direct:

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.”

Material adds an important operational distinction:

> “When using a determinate indicator, the indicator must accurately represent the progress of what it's measuring.”

#### Product implication

Because browser singing synthesis often takes seconds rather than milliseconds, the UI must expose **pipeline-aware status**, not just a generic spinner.

Recommended render states:

1. **Queued** — waiting behind another phrase or model load.
2. **Preparing** — phonemizing / building tensors.
3. **Synthesizing expression** — AI pitch/variance pass.
4. **Rendering audio** — acoustic + vocoder pass.
5. **Ready** — cached and playable.
6. **Stale** — visible change exists that has not yet been re-rendered.
7. **Preview quality** vs **final quality** — explicitly labeled.

Recommended UI treatment:

- phrase-level progress bars on the canvas,
- a global render queue panel,
- a cache badge on phrases that are already up to date,
- “stale after edit” indicators,
- explicit cancel / reprioritize actions,
- and an estimate only when confidence is good enough.

#### Why this matters

In music tools, uncertainty kills flow. If the user cannot tell whether the app is loading a model, rendering a phrase, waiting on a queue, or simply frozen, trust collapses fast.

---

### 5. Progressive disclosure is mandatory

Singing synthesis is inherently parameter-heavy. That does not mean the default UI has to be overwhelming.

NN/g’s guidance is simple:

> “To reduce complexity in a user interface, employ progressive disclosure to defer secondary options...”

And in complex applications specifically, designers should prevent overwhelm by “putting things in predictable places, using a clear visual hierarchy, and taking advantage of progressive disclosure.”

#### Product implication

The app should ship with a **three-layer control model**:

##### Layer 1 — fast composition view

Visible by default.

- arrangement timeline
- piano roll
- lyrics on notes
- playback and loop controls
- voice selector
- one-click render / preview
- one expression preset selector
- one macro slider group: naturalness, energy, brightness, gender, breathiness

This is the mode for most users, most of the time.

##### Layer 2 — guided vocal shaping

Shown on demand, still friendly.

- pitch deviation lane
- vibrato lane or vibrato overlay tool
- phoneme timing view
- phrase-level retakes
- note properties panel
- language / pronunciation assistance
- parameter lane chooser

This is where everyday serious editing happens.

##### Layer 3 — expert surgery

Hidden until explicitly opened.

- per-phoneme duration table
- raw variance curves
- seed control
- retake masks
- model quality/speed selector
- speaker-blend curves
- frame-level expression tools
- debug / provenance panel

This is where power users can go deep without scaring everyone else.

#### Default rule

Never show every lane, every parameter, and every AI option at once. Let users progressively “open the instrument.”

---

### 6. The right mental model: not a chatbot, an instrument

The best research on music-oriented AI co-creation points in a consistent direction: musicians enjoy novelty, but they quickly become frustrated when AI is unpredictable or untraceable.

From an evaluation of a creative AI music system:

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.”

From a study of composers evaluating an AI music tool:

> “Concerns around trust, transparency, and ethical design” shaped feedback.

> “Composers valued transparency in how variations evolve from the source material.”

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output... could help them better understand and select variations that align with their artistic intentions.”

This is exactly the right design constraint for browser-first singing synthesis.

#### Product implication

The app should present AI as an **auditionable variation engine with visible causality**, not as an all-knowing generator.

That means:

- show what changed,
- show why it changed,
- show how to undo it,
- let users pin what should stay fixed,
- and let users compare multiple alternatives side by side.

#### Specific UI patterns for AI trust

##### A. Retake trays

For any phrase or selected note range, offer 3–5 retakes as mini-cards:

- waveform thumbnail
- pitch contour thumbnail
- tags like “more natural,” “brighter consonants,” “flatter pitch,” “stronger vibrato”
- seed / model / mode metadata
- one-click apply
- one-click pin original

##### B. Change overlays

When AI regenerates something, overlay the delta:

- old pitch in gray,
- new pitch in color,
- changed phoneme durations as highlighted splits,
- changed parameters as shaded deltas.

##### C. Locks and scopes

Users should be able to lock:

- note timing,
- pitch,
- lyrics,
- phoneme timing,
- voice identity,
- selected parameter lanes.

Then “Regenerate” works only on the unlocked scope.

##### D. Provenance chips

Every generated phrase should expose lightweight provenance:

- voice,
- language,
- seed,
- render quality,
- date/time,
- cache status,
- model version.

Trust improves when outputs are legible objects rather than mysterious artifacts.

---

### 7. The winning workspace layout

The best default workspace for this category is a **three-region pro-app layout**.

#### Region 1 — arrangement strip

Top band.

Purpose:

- project overview,
- track relationships,
- phrase boundaries,
- muting/soloing,
- loop range,
- section naming,
- quick navigation.

Design target: enough context to think musically, not enough detail to edit phonemes.

#### Region 2 — primary piano-roll editor

Largest center region.

Purpose:

- note placement,
- lyric entry,
- pitch and timing editing,
- phrase selection,
- audition,
- overlays for generated pitch and expression.

This must remain the visual center of the app.

#### Region 3 — contextual inspector

Right side by default, collapsible.

Purpose:

- exact values,
- voice/style settings,
- retakes,
- parameter tabs,
- pronunciation tools,
- note properties,
- export / render details.

Future Music’s review of Synthesizer V 2 describes a pattern worth copying:

> “The green tinted user interface works with the familiar piano roll environment and then utilizes clever tabs along the right side to open up specific parameters...”

That is a strong model because it keeps the canvas primary while still making deep settings nearby.

#### Bottom utility strip

Optional, collapsible.

Use for:

- mixer,
- render queue,
- warnings,
- batch operations,
- comparison player,
- model downloads.

#### Layout rule

The center canvas should never get visually bullied by chrome. Producers need room to see notes, words, and curves.

---

### 8. Parameter editing should use linked controls, not single controls

NN/g’s recommendation is especially relevant here:

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.”

And another NN/g guideline warns:

> “Users will have a hard time achieving precision” with pure path-steering controls like sliders unless additional mechanisms exist.

#### Product implication

Every expressive vocal parameter should support **three linked editing modes**:

1. **Macro control** — slider / knob / preset chip.
2. **Precise numeric control** — exact value entry.
3. **Temporal control** — draw lane / handles on a curve.

For example, breathiness:

- global track slider for quick exploration,
- note-level number input for exact matches,
- automation lane for phrase shaping.

For vibrato:

- preset chips like Natural / Pop / Dramatic / None,
- rate/depth numeric fields,
- visual envelope overlay directly on selected notes.

#### Why this matters

Music editing alternates between broad expressive exploration and surgical correction. A single control type never covers both modes well.

---

### 9. The most valuable editing flows

The highest-value UI work is not glamorous. It is the set of loops users repeat hundreds of times.

#### Flow 1 — sketch melody fast

User goal: rough in melody and lyrics as fast as possible.

Best pattern:

- paste or import MIDI,
- inline lyric typing across selected notes,
- quick split/merge notes,
- real-time piano pitch preview when moving notes,
- auto phrase segmentation,
- instant low-quality preview.

#### Flow 2 — fix one awkward word

User goal: stop one lyric from sounding wrong.

Best pattern:

- click note,
- open pronunciation popover near the note,
- edit phoneme timing inline,
- A/B solo that note or microphrase,
- no need to open a separate screen.

This is strongly supported by user praise for phoneme timing features in SynthV.

#### Flow 3 — audition expressive alternatives

User goal: try different interpretations without losing the current one.

Best pattern:

- select phrase,
- generate retakes,
- preview each in place,
- compare with original,
- apply only pitch, only timing, only timbre, or all.

#### Flow 4 — tune a repeated chorus fast

User goal: propagate useful settings across sections.

Best pattern:

- copy/paste vocal settings across groups,
- save reusable expression presets,
- apply lane presets to selected regions,
- link repeated phrases optionally,
- allow break-link for local changes.

This directly addresses public user requests around copy-paste and faster repeated edits.

#### Flow 5 — micro-edit and replay

User goal: tweak, replay same bar, tweak again.

Best pattern:

- playhead return on stop,
- sticky loop,
- pre-roll toggle,
- instant phrase-only replay,
- audition selection shortcut.

If this loop is not frictionless, the whole product feels slow no matter how good the synthesis is.

---

### 10. Browser-specific UX opportunities

A browser-first singing tool has limitations, but it also has a few unusual UX advantages.

#### Advantage 1 — frictionless entry

Users can open a project link or demo in seconds. That makes onboarding, templates, and collaboration previews easier than desktop-only tools.

#### Advantage 2 — progressive asset loading

A browser app can start with a thin shell and pull models, voices, and optional tools on demand. The UI can treat heavy capabilities as installable modules instead of initial clutter.

#### Advantage 3 — better empty states

NN/g notes:

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.”

This is especially powerful in a browser context, where the app may initially have no downloaded voice, no project, and no cached audio.

Recommended empty states:

- **No project loaded:** show template choices and import options.
- **No voice installed:** explain voice packs and offer one-click starter voice.
- **No phrase selected:** show quick actions relevant to the current track.
- **No render yet:** show how preview vs final rendering works.
- **No audio permission / MIDI unavailable:** clear browser-specific guidance.

#### Advantage 4 — inline docs and examples

Because help content can live in the same shell, browser products can embed mini tutorials, hover demos, and example projects without forcing the user into PDFs or external docs.

---

### 11. Latency UX is a product feature, not a fallback

Jakob Nielsen’s classic response-time thresholds still matter:

- around **0.1 seconds** feels instantaneous,
- around **1 second** keeps flow mostly uninterrupted,
- around **10 seconds** risks losing attention.

A browser singing tool often lands in the 1–10 second zone for meaningful synthesis work. That means the app must be designed for **productive waiting**.

NN/g’s summary on complex applications is directly relevant:

> “5 guidelines help users tolerate the long waits and frequent interruptions that are typical of complex workflows.”

#### Product implication

While a phrase renders, the user should still be able to:

- edit another track,
- type lyrics,
- scrub existing audio,
- queue another render,
- inspect retakes already generated,
- and continue arranging.

#### Recommended latency patterns

##### A. Two-tier rendering

- Draft preview renders automatically.
- Final-quality renders are explicit and batchable.

##### B. Phrase-local invalidation

Only the edited phrase becomes stale. Everything else remains playable.

##### C. Predictive pre-render

When the user stops editing for a beat, pre-render likely next actions:

- current phrase,
- neighboring phrase,
- selected retake candidate.

##### D. Transparent prioritization

Let users choose:

- render current selection first,
- render audible loop range,
- render all stale phrases in background.

##### E. Accurate progress language

Never say “almost done” unless you know that. Use honest stage labels instead.

---

### 12. Accessibility and inclusivity requirements

This category often ignores accessibility because it is seen as a pro tool. That is a mistake.

A browser-first product should aim to be better than incumbents in a few concrete ways.

#### Essential accessibility requirements

- full keyboard navigation for transport, note nudging, and selection
- screen-reader labels for controls, state badges, and progress
- high-contrast theme and robust zoom
- non-color-only status signaling
- large enough note handles and lane targets
- reduced-motion option for animated cursors and loading indicators
- captions/text summaries for AI warnings and render errors

#### Power-user accessibility is workflow accessibility

Apple’s keyboard guidance is relevant here:

> “Keyboard users often appreciate using keyboard shortcuts to speed up their interactions...”

In pro creative software, keyboard efficiency is not only an expert luxury. It is an accessibility feature for anyone minimizing strain, avoiding precision mousing, or working quickly.

#### High-value shortcut targets

- nudge note left/right/up/down
- split/merge note
- cycle parameter lanes
- open pronunciation editor
- audition selected phrase
- generate retakes
- accept best retake
- lock/unlock selection
- return playhead to start of selection

---

### 13. User feedback themes that should drive the roadmap

Across product reviews, manuals, and public community feedback, the same needs keep showing up.

#### Theme 1 — Familiarity wins

Users repeatedly respond well to piano-roll and DAW-like paradigms because they reduce learning cost.

> “The familiar piano roll environment...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

#### Theme 2 — Fine-grained pronunciation control matters

This is one of the clearest recurring praise points.

> “Phoneme editing is vastly superior.”

> “The phoneme timing panel... allows for easier control over the way different words are pronounced.”

#### Theme 3 — AI must stay controllable

Users appreciate assistance, but not when it becomes hard to predict or steer.

> “Limitations on controllability and predictability...” — study on AI music-composition UX

#### Theme 4 — Transparency builds trust

Not only around ethics, but around outputs and transformations.

> “Composers valued transparency in how variations evolve from the source material.”

#### Theme 5 — Small workflow irritations are disproportionately expensive

Requests for better copy/paste, note nudging, playhead behavior, and locking may look minor, but they compound over every session.

#### Theme 6 — Complexity is acceptable only when layered

Users will tolerate a deep tool if the first-run view is legible and advanced editing is progressively disclosed.

---

### 14. Recommended feature-to-pattern mapping

| Product need               | Best UI pattern                                   | Why                       |
| -------------------------- | ------------------------------------------------- | ------------------------- |
| Melody entry               | Piano roll with inline lyric entry                | Familiar, fast, scalable  |
| Global vocal shaping       | Macro parameter strip + presets                   | Fast exploration          |
| Precise expression editing | Automation lanes and direct pitch drawing         | Fine control              |
| AI variation               | Retake tray with side-by-side compare             | Trust + audition          |
| Pronunciation fixes        | Inline phoneme popover and timing panel           | Localized problem solving |
| Style switching            | Inspector presets + region-based automation       | Powerful but contained    |
| Long renders               | Phrase progress, stale badges, queue panel        | Clear feedback            |
| Repeat edits               | Presets, copy/paste attributes, linked phrases    | Efficiency                |
| Multi-track work           | DAW-like arrangement strip and mixer drawer       | Context                   |
| Learnability               | Empty states, templates, guided overlays          | Faster activation         |
| Browser constraints        | Progressive loading and installable voice modules | Lower startup cost        |
| Power-user speed           | Keyboard-first editing and context menus          | Reduced friction          |

---

### 15. UX blueprint for the MVP

The MVP should not try to expose every parameter. It should prove the workflow.

#### MVP screen design

##### Top bar

- project name
- save status
- undo/redo
- transport
- loop toggle
- render selection
- voice picker
- model/cache status

##### Left sidebar

- project navigator
- track list
- templates
- assets / installed voices

##### Center

- arrangement mini-map on top
- piano roll below
- inline lyrics on notes
- optional one visible lane at a time under notes

##### Right inspector

Tabbed:

- Voice
- Note
- Pronunciation
- Retakes
- Render

##### Bottom drawer

- mixer
- render queue
- warnings/log

#### MVP interaction goals

The first session should let a new user:

1. load a template,
2. enter or import notes,
3. type lyrics,
4. click preview,
5. fix one word,
6. draw one pitch change,
7. compare one retake,
8. export audio.

If the product cannot make those eight steps feel obvious, it is not ready, even if the model stack is impressive.

---

### 16. UX blueprint for the full product

#### Phase 1 — browser proof of workflow

Goal: show that the browser can feel like a real editing tool, not a demo.

Must-have UX:

- one voice
- one language
- piano roll
- lyric entry
- phrase preview
- progress states
- undo/redo
- downloadable demo project

#### Phase 2 — serious editing

Goal: become usable for actual song sections.

Add:

- pronunciation editor
- direct pitch drawing
- note properties
- parameter lanes
- keyboard shortcuts
- looped audition
- phrase cache states

#### Phase 3 — AI trust layer

Goal: make generation feel professional, not random.

Add:

- retake tray
- scoped regeneration
- locks
- A/B compare
- provenance chips
- preview/final quality distinction

#### Phase 4 — arrangement-grade workspace

Goal: compete with standalone editors on daily usability.

Add:

- multi-track arrangement
- mixer drawer
- track colors and grouping
- reusable presets
- linked chorus phrases
- batch rendering

#### Phase 5 — pro depth

Goal: satisfy advanced vocal producers.

Add:

- frame-level expert controls
- speaker/style automation
- collaborative review links
- region comments
- advanced keyboard customization
- workspace presets

---

### 17. UX risk register

| Risk                                               | Severity | Likelihood | UX mitigation                                                  |
| -------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------- |
| Interface feels like a research demo, not a DAW    | High     | High       | Anchor everything in arrangement + piano roll                  |
| Too many visible controls overwhelm users          | High     | High       | Three-layer progressive disclosure                             |
| AI output feels random or untrustworthy            | High     | High       | Retakes, locks, change overlays, provenance                    |
| Browser rendering delays feel like freezing        | High     | High       | Detailed system-status feedback and queue control              |
| Advanced controls become form-heavy and slow       | Medium   | High       | Keep editing on-canvas; inspector only for precision           |
| Repeat tasks become tedious                        | High     | High       | Copy/paste attributes, presets, linked phrases, shortcuts      |
| Accidental edits break trust                       | Medium   | High       | Strong undo, object locking, non-destructive operations        |
| Users cannot learn why a phrase sounds wrong       | Medium   | Medium     | Pronunciation guidance, visible phoneme timing, smart warnings |
| Large workspace feels cramped in browser           | Medium   | High       | Collapsible panels, focus modes, bottom drawers                |
| Product excludes keyboard-only or low-vision users | Medium   | Medium     | Shortcut parity, high contrast, robust zoom, accessible labels |

---

### 18. What “best-in-class” looks like

A best-in-class browser singing product would feel like this:

- Opening the app presents a clear project shell, not a blank technical screen.
- The first meaningful action happens in under a minute.
- Notes, words, and curves are edited directly on the canvas.
- AI defaults are good, but never final unless the user wants them to be.
- Every generated change is visible, comparable, and undoable.
- Waits are explained precisely enough that the user never thinks the tab is dead.
- Advanced power is available, but not dumped on day-one users.
- Repetitive micro-edits are fast because shortcuts, presets, and playhead behavior are thoughtfully designed.
- The user feels they are playing an instrument and directing a performer, not wrestling a machine-learning pipeline.

---

### 19. Final recommendation

The best UI/UX strategy is to build **the most legible, direct, and trustworthy singing editor in the category**, not the flashiest AI interface.

The evidence points to a simple product thesis:

1. **Use a DAW-like arrangement plus piano-roll center of gravity.**
2. **Make expression editing direct and visual.**
3. **Hide depth until it is needed.**
4. **Treat AI as a set of scoped, reversible suggestions.**
5. **Make latency visible and manageable.**
6. **Obsess over tiny workflow details.**

That combination is more important than any single model feature. The products users praise most are not just the ones that sound good. They are the ones that let users get from idea to convincing result without confusion, fear, or wasted motion.

In other words: **AceStudio parity on UI/UX is achievable, but it will come less from copying visual design and more from mastering workflow design.**

---

### Appendix: quoted evidence used in this report

#### Product and review signals

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

> “The green tinted user interface works with the familiar piano roll environment and then utilizes clever tabs along the right side to open up specific parameters...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

#### Manual and official workflow signals

> “Synthesizer V Studio allows a combination of automatic pitch generation by AI, direct editing of pitch curves, and manual pitch editing using parameters.” — Synthesizer V manual

> “The AI Retakes panel allows you to adjust the amount of variation in the pitch curves generated by the AI.” — Synthesizer V manual

> “In Direct Pitch Editing mode, edit the pitch curves directly on the Piano Roll.” — Synthesizer V manual

#### Public user feedback signals

> “The workflow is improved, the phoneme editing is vastly superior.” — user comment, r/SynthesizerV

> “I love the new mouth opening parameter and the phoneme timing panel...” — user comment, r/SynthesizerV

> “Allow copy-paste of vocal mode settings between groups.” — user comment, r/SynthesizerV

> “Add shortcuts to nudge selected notes...” — user comment, r/SynthesizerV

> “Option to lock/unlock group positions...” — user comment, r/SynthesizerV

#### UX and HCI signals

> “Direct manipulation is an interaction style in which UI elements are visible and can be acted upon via actions that receive immediate feedback.” — Nielsen Norman Group

> “The visibility of system status is a basic tenet of a great user experience.” — Nielsen Norman Group

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.” — Nielsen Norman Group

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.” — Nielsen Norman Group

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.” — Apple Human Interface Guidelines

#### Human-AI music research signals

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.” — study on AI music-composition UX

> “Composers valued transparency in how variations evolve from the source material.” — study on composers evaluating an AI music tool

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output...” — study on composers evaluating an AI music tool
