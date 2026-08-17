---
type: research
id: RESEARCH-audio-generation
title: Local-first AI singing synthesis feasibility
status: open
owner: The Sourdaw team
sources:
  - Local-first AI audio generation feasibility study, 2026-Q1
---

# Research: Local-first AI singing synthesis feasibility

> Co-located research doc for `.agents/specs/audio-generation/spec.md`. The "Restored research"
> appendices below carry verbatim content recovered from the original source
> `research/pipelines/audio-generation.md` (git rev `bb84b0e`) that was condensed away
> during the docs migration. R-009 in the Findings above summarizes the UX report; the
> full report and the secondary pipeline blueprints now live here.

## Question

Is local-first AI singing synthesis (MIDI + lyrics → vocals) feasible inside a Tauri DAW
today, and which model stack, runtime architecture, and packaging strategy give the best
quality-to-effort ratio for a first shippable feature?

## Findings

### R-001 — DiffSinger via ONNX is the production-proven singing engine

- **Claim:** DiffSinger exported to ONNX is the only singing-synthesis pipeline
  proven in a shipped desktop app, reaching ~70–80% of AceStudio's naturalness for
  straightforward singing; SoulX-Singer, TokenSynth, and ACE-Step lack validated ONNX exports.
- **Evidence:** OpenUtau ships DiffSinger ONNX inference in C# (`DiffSingerRenderer.cs`); the
  capability matrix marks DiffSinger ONNX support "mature, first-class" and competitors "not yet".
- **Confidence:** high
- **Bears on:** AC-001 (the DiffSinger pipeline) and the build-now vs prototype tier boundary.

### R-002 — The reference community vocoder is license-unsafe; BigVGAN v2 + Vocos are not

- **Claim:** The community DiffSinger vocoder is CC-BY-NC-SA 4.0 and must not ship; BigVGAN v2
  (MIT, 45–135× realtime) and Vocos (MIT, ~6,700× realtime) are the license-safe quality and
  preview vocoders respectively.
- **Evidence:** vocoder license/speed table; risk register rates the reference license
  "High severity, Certain likelihood".
- **Confidence:** high
- **Bears on:** AC-005 (dual vocoder) and AC-010 (no non-commercial weights).

### R-003 — Mel-spectrogram compatibility between DiffSinger and MIT vocoders is unproven

- **Claim:** DiffSinger emits 128-bin mel at a specific configuration; BigVGAN v2 was trained on a
  potentially different mel layout, so a drop-in MIT vocoder may need a mel adapter or fine-tune.
- **Evidence:** OpenUtau pairs DiffSinger with a CC-BY-NC-SA reference vocoder; no documented drop-in
  MIT vocoder for DiffSinger mel exists.
- **Confidence:** medium
- **Bears on:** the blocking open question gating implementation, and AC-005.

### R-004 — A hybrid runtime (native ONNX + Python sidecar) beats pure approaches

- **Claim:** Running DiffSinger ONNX in-process via `ort` while reserving a Python sidecar for
  models without clean ONNX exports (RVC) yields the best mix of installer size, latency, and
  crash isolation; a pure-Python sidecar adds a ~2.6 GB minimum binary and 2–5 s startup.
- **Evidence:** architecture comparison table (Option C "Hybrid" recommended); `ort` v2 native
  binary is ~50–100 MB vs the PyInstaller+CUDA sidecar at 2–5 GB.
- **Confidence:** high
- **Bears on:** AC-003 (model router) and AC-009 (graceful sidecar degradation).

### R-005 — RVC is the in-scope MIT voice-conversion lever

- **Claim:** RVC/Applio (MIT, HuBERT + VITS + FAISS) is mature with a partial ONNX export and is
  the recommended optional post-processing step for custom timbre; its full pipeline lacks a
  validated single-ONNX export, so it stays on the sidecar.
- **Evidence:** voice-conversion table; build-now verdict for RVC post-processing.
- **Confidence:** high
- **Bears on:** AC-009 (RVC via sidecar) and the file-in/file-out transport decision.

### R-006 — No neural singing model is truly real-time; offline-render-then-play is the model

- **Claim:** No singing model achieves sub-20 ms latency on consumer hardware; DiffSinger shallow
  diffusion reaches "interactive preview" at 2–5 s per phrase on GPU (~1 s with reduced steps).
- **Evidence:** realtime-viability tiering table; shallow-diffusion ~50× speedup noted.
- **Confidence:** high
- **Bears on:** AC-005 (preview/final modes) and AC-008 (render queue), and the no-streaming non-goal.

### R-007 — Staged packaging avoids a 5–15 GB installer

- **Claim:** A thin (~100–200 MB) installer with `ort` statically linked, first-run GPU detection,
  and on-demand HuggingFace model downloads (DiffSinger voice ≈ 200–400 MB, RVC ≈ 150 MB,
  BigVGAN v2 ≈ 400 MB) is the proven distribution pattern.
- **Evidence:** packaging section; pattern matches LM Studio, Stability Matrix, ComfyUI Desktop.
- **Confidence:** high
- **Bears on:** AC-004 (download infrastructure) and the deferred first-run wizard.

### R-008 — GPU execution-provider coverage requires DirectML, not CPU, as the Windows fallback

- **Claim:** ONNX Runtime should use CoreML (macOS), DirectML (any DX12 GPU on Windows, covering
  AMD/Intel/NVIDIA), and CUDA (Linux), with CPU as last resort only.
- **Evidence:** per-platform GPU handling table; DirectML noted as zero-install GPU path on Windows.
- **Confidence:** high
- **Bears on:** AC-011 (per-platform EP selection).

### R-009 — A producer-first, AI-as-reversible-assistant UX is the parity lever, not visual mimicry

- **Claim:** AceStudio/Synthesizer V parity comes from DAW-arrangement + piano-roll direct
  manipulation, progressive disclosure, honest pipeline-stage status, retakes/locks/change
  overlays/provenance, and frictionless micro-edit-and-replay loops — not from a chat-first or
  AI-first interface.
- **Evidence:** UX blueprint synthesizing NN/g direct-manipulation and visibility-of-status
  guidance, Apple HIG progress-indicator guidance, Synthesizer V manual and r/SynthesizerV
  feedback, and human-AI co-creation studies.
- **Confidence:** medium
- **Bears on:** the deferred companion vocal-editor UX spec (retake tray, locks, change overlays,
  pronunciation editor, three-region layout) and the honest stage-label requirement.

## Open questions

- [ ] Q-001 — Is BigVGAN v2 mel-compatible with DiffSinger out of the box, or is an adapter/fine-tune
  required? (blocking; carried to the spec)
- [ ] Q-002 — Which default English voicebank has fully MIT/Apache-2.0 acoustic weights?
- [ ] Q-003 — Exact ONNX tensor format (opset, dynamic axes, optional speaker embedding) of the
  shipped DiffSinger files?

## Recommendation

Build MIDI + lyrics → singing voice first, on a hybrid runtime: the full DiffSinger ONNX pipeline
in Rust via `ort` (R-001, R-004), BigVGAN v2 + Vocos as the dual MIT vocoder (R-002) pending a
mel-compatibility spike (R-003), RVC voice conversion as optional sidecar post-processing (R-005),
offline phrase rendering with preview/final modes (R-006), staged packaging with on-demand
downloads (R-007), and per-platform GPU EP selection with DirectML on Windows (R-008). Treat the
producer-first, reversible-AI UX (R-009) as a separate companion spec.

---

## Restored appendix A — Secondary pipeline blueprints (Pipeline B and C)

> Restored verbatim from `research/pipelines/audio-generation.md` (rev `bb84b0e`),
> section "3. Pipeline blueprints". These two blueprints back R-009's tiering and the
> spec's "Dropped from sources" (TokenSynth/MIDI-DDSP instruments, RAVE timbre transfer).
> Pipeline A (the recommended MVP) is captured in R-001/R-004 above; B and C are the
> prototype/wait-tier alternatives that were condensed out.

### Pipeline B: MIDI → expressive performance → neural instrument audio

This pipeline adds human-like expression to flat MIDI scores, then synthesizes instrument audio.

```
┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐
│ Flat     │───▶│ Performance   │───▶│ TokenSynth   │───▶│ DAC Decoder  │──▶ 44.1kHz WAV
│ MIDI     │    │ Renderer      │    │ (MIT)        │    │ (MIT)        │    (any instrument)
│ Score    │    │ (DExter or    │    │ MIDI → codec │    │              │
│          │    │  ScorePerf.)  │    │ tokens via   │    │              │
│          │    │ adds dynamics,│    │ 5s audio ref │    │              │
│          │    │ timing, artic.│    │ or text desc │    │              │
└──────────┘    └───────────────┘    └──────────────┘    └──────────────┘

                    Alternative instrument path (piano only):
                                  ┌──────────────┐    ┌──────────────┐
                           ──────▶│ MIDI-VALLÉ   │───▶│ EnCodec      │──▶ Piano WAV
                                  │ (CC-BY 4.0)  │    │ Decoder      │
                                  │ + 3s piano   │    │              │
                                  │   reference  │    │              │
                                  └──────────────┘    └──────────────┘
```

**Runtime**: PyTorch via Python sidecar (TokenSynth and MIDI-VALLÉ are not ONNX-exportable yet). **Latency**: 10–60 seconds per phrase (offline). **Key limitation**: TokenSynth has only 4 velocity levels; MIDI-DDSP outputs 16 kHz mono. Neither matches commercial sample libraries. **Best current use**: creative/experimental instrument sounds, not production orchestration.

### Pipeline C: audio → timbre transformation → new instrument identity

This pipeline takes existing audio and transforms its timbre while preserving musical content.

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Source   │───▶│ F0 + Loud-   │───▶│ DDSP Decoder │───▶│ Output Audio │
│ Audio    │    │ ness Extract │    │ (Apache 2.0) │    │ (monophonic, │
│ (voice,  │    │ (CREPE/RMVPE)│    │ trained on   │    │  target      │
│  guitar) │    │              │    │ target instr │    │  instrument) │
└──────────┘    └──────────────┘    └──────────────┘    └──────────────┘

                    Alternative (creative/polyphonic):
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Source   │───▶│ RAVE Encoder │───▶│ Latent Space │───▶│ RAVE Decoder │──▶ Transformed
│ Audio    │    │ (trained on  │    │ Manipulation │    │ (realtime,   │    Audio
│          │    │  target      │    │ (interpolate,│    │  20× RT on   │
│          │    │  instrument) │    │  morph, mix) │    │  CPU)        │
│          │    │              │    │              │    │              │
└──────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

**DDSP path**: Realtime, excellent pitch preservation, monophonic only. Apache 2.0. Needs 13 minutes of training audio per instrument. **RAVE path**: Realtime (20× on CPU), handles polyphonic material, but pitch preservation is approximate and each model must be trained on a specific instrument corpus. **AFTER path** (IRCAM): Higher quality disentanglement of timbre from structure, realtime via MaxMSP, but less mature tooling.

---

## Restored appendix B — UX report: Browser-first singing synthesis, achieving AceStudio parity on UI/UX

> Restored verbatim from `research/pipelines/audio-generation.md` (rev `bb84b0e`),
> the entire second report (original lines 355–1292). This is the full ~17-section UX
> blueprint that R-009 summarizes in a single finding. It grounds the deferred companion
> vocal-editor UX spec and the spec's honest stage-label, latency-UX, and accessibility
> requirements.

# Browser-first singing synthesis: achieving AceStudio parity on UI/UX

**The UI/UX challenge is not to invent a radically new interface. It is to combine three patterns that users already understand — DAW arrangement, piano-roll note editing, and AI-assisted direct manipulation — into a browser-first workflow that feels fast, traceable, and safe to experiment with.** The strongest evidence from current singing-synthesis products and broader HCI research points in the same direction: users want familiar editing surfaces, immediate visual feedback, lightweight access to advanced controls, and AI that behaves like a reversible assistant rather than an opaque black box. The best path is not “AI-first UI.” It is **producer-first UI with AI embedded into existing music workflows**.

This report translates that into a full product blueprint for a browser-local singing editor. It covers benchmarked patterns from ACE Studio and Synthesizer V, user feedback from public communities, complex-application UX guidance, and human-AI co-creation research. The conclusion is straightforward: a browser app can compete on usability if it is built around **fast iteration, strong system-status visibility, progressive disclosure, robust keyboard workflows, and traceable AI suggestions**.

---

## 1. Core conclusion

A browser-first singing tool should aim for **DAW familiarity on the surface and AI depth underneath**.

That means:

- **Primary canvas:** arrangement + piano roll, not chat.
- **Primary interaction style:** direct manipulation, not form filling.
- **Primary AI role:** generate, suggest, retake, and explain — never trap the user.
- **Primary trust mechanism:** every AI output must be previewable, comparable, undoable, and attributable to visible controls.
- **Primary performance rule:** the interface must stay interactive even when synthesis is not instant.

The key benchmark products already signal this direction. ACE Studio 2.0 is described as adding “a more DAW-like workflow” and “a DAW-like environment canvas.” Synthesizer V is repeatedly praised for its familiar piano-roll workflow, phoneme editing, and parameter control. Broader UX research reinforces the same pattern: complex creative tools work best when visible objects can be edited directly, system status is always clear, and advanced complexity is layered rather than dumped on screen.

---

## 2. What current products are teaching us

### ACE Studio’s visible trajectory

ACE Studio’s strongest UI signal is not any single feature. It is the move toward **an all-in-one music workspace**.

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — John Walden, _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

That matters because it suggests where user expectations are heading:

1. A singing tool is no longer judged only as a voice editor.
2. Users increasingly expect arrangement context, audio context, and generation context in one place.
3. Browser-first products should avoid forcing constant mode switches between “editor,” “generator,” and “export tool.”

### Synthesizer V’s stronger day-to-day workflow signal

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

### The practical benchmark

The best competitive target is therefore not “copy AceStudio’s look” or “copy SynthV’s layout.” It is to match the **underlying workflow principles**:

- DAW-like overview at the project level,
- piano-roll precision at the note level,
- curve editing for expression,
- simple default views with deep optional controls,
- and AI retakes that fit into an editing workflow rather than interrupt it.

---

## 3. The most important UX principle: direct manipulation

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

### Product implication

The interface should treat **notes, phonemes, curves, retakes, and phrase boundaries as manipulable objects**, not settings buried in dialogs.

The browser UI should therefore prioritize:

- drag note to move pitch/time,
- drag note edge to change duration,
- drag phoneme split handles,
- draw pitch deviation directly over notes,
- draw breath/tension/gender curves inline,
- drag retake options onto a phrase or selected note region,
- audition changes on hover or scrubbing where feasible.

### Anti-pattern to avoid

Do not turn advanced vocal editing into a stack of sidebar forms. Sidebars are useful for exact values and presets, but the main work should happen on the canvas.

---

## 4. The second principle: visibility of system status

Browser-local singing synthesis has an unavoidable UX problem: generation is not instant. That makes feedback design central.

NN/g’s warning is blunt:

> “The visibility of system status is a basic tenet of a great user experience.”

And for complex applications:

> “The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time.”

Apple’s guidance on progress indicators is equally direct:

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.”

Material adds an important operational distinction:

> “When using a determinate indicator, the indicator must accurately represent the progress of what it's measuring.”

### Product implication

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

### Why this matters

In music tools, uncertainty kills flow. If the user cannot tell whether the app is loading a model, rendering a phrase, waiting on a queue, or simply frozen, trust collapses fast.

---

## 5. Progressive disclosure is mandatory

Singing synthesis is inherently parameter-heavy. That does not mean the default UI has to be overwhelming.

NN/g’s guidance is simple:

> “To reduce complexity in a user interface, employ progressive disclosure to defer secondary options...”

And in complex applications specifically, designers should prevent overwhelm by “putting things in predictable places, using a clear visual hierarchy, and taking advantage of progressive disclosure.”

### Product implication

The app should ship with a **three-layer control model**:

#### Layer 1 — fast composition view

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

#### Layer 2 — guided vocal shaping

Shown on demand, still friendly.

- pitch deviation lane
- vibrato lane or vibrato overlay tool
- phoneme timing view
- phrase-level retakes
- note properties panel
- language / pronunciation assistance
- parameter lane chooser

This is where everyday serious editing happens.

#### Layer 3 — expert surgery

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

### Default rule

Never show every lane, every parameter, and every AI option at once. Let users progressively “open the instrument.”

---

## 6. The right mental model: not a chatbot, an instrument

The best research on music-oriented AI co-creation points in a consistent direction: musicians enjoy novelty, but they quickly become frustrated when AI is unpredictable or untraceable.

From an evaluation of a creative AI music system:

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.”

From a study of composers evaluating an AI music tool:

> “Concerns around trust, transparency, and ethical design” shaped feedback.

> “Composers valued transparency in how variations evolve from the source material.”

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output... could help them better understand and select variations that align with their artistic intentions.”

This is exactly the right design constraint for browser-first singing synthesis.

### Product implication

The app should present AI as an **auditionable variation engine with visible causality**, not as an all-knowing generator.

That means:

- show what changed,
- show why it changed,
- show how to undo it,
- let users pin what should stay fixed,
- and let users compare multiple alternatives side by side.

### Specific UI patterns for AI trust

#### A. Retake trays

For any phrase or selected note range, offer 3–5 retakes as mini-cards:

- waveform thumbnail
- pitch contour thumbnail
- tags like “more natural,” “brighter consonants,” “flatter pitch,” “stronger vibrato”
- seed / model / mode metadata
- one-click apply
- one-click pin original

#### B. Change overlays

When AI regenerates something, overlay the delta:

- old pitch in gray,
- new pitch in color,
- changed phoneme durations as highlighted splits,
- changed parameters as shaded deltas.

#### C. Locks and scopes

Users should be able to lock:

- note timing,
- pitch,
- lyrics,
- phoneme timing,
- voice identity,
- selected parameter lanes.

Then “Regenerate” works only on the unlocked scope.

#### D. Provenance chips

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

## 7. The winning workspace layout

The best default workspace for this category is a **three-region pro-app layout**.

### Region 1 — arrangement strip

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

### Region 2 — primary piano-roll editor

Largest center region.

Purpose:

- note placement,
- lyric entry,
- pitch and timing editing,
- phrase selection,
- audition,
- overlays for generated pitch and expression.

This must remain the visual center of the app.

### Region 3 — contextual inspector

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

### Bottom utility strip

Optional, collapsible.

Use for:

- mixer,
- render queue,
- warnings,
- batch operations,
- comparison player,
- model downloads.

### Layout rule

The center canvas should never get visually bullied by chrome. Producers need room to see notes, words, and curves.

---

## 8. Parameter editing should use linked controls, not single controls

NN/g’s recommendation is especially relevant here:

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.”

And another NN/g guideline warns:

> “Users will have a hard time achieving precision” with pure path-steering controls like sliders unless additional mechanisms exist.

### Product implication

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

### Why this matters

Music editing alternates between broad expressive exploration and surgical correction. A single control type never covers both modes well.

---

## 9. The most valuable editing flows

The highest-value UI work is not glamorous. It is the set of loops users repeat hundreds of times.

### Flow 1 — sketch melody fast

User goal: rough in melody and lyrics as fast as possible.

Best pattern:

- paste or import MIDI,
- inline lyric typing across selected notes,
- quick split/merge notes,
- real-time piano pitch preview when moving notes,
- auto phrase segmentation,
- instant low-quality preview.

### Flow 2 — fix one awkward word

User goal: stop one lyric from sounding wrong.

Best pattern:

- click note,
- open pronunciation popover near the note,
- edit phoneme timing inline,
- A/B solo that note or microphrase,
- no need to open a separate screen.

This is strongly supported by user praise for phoneme timing features in SynthV.

### Flow 3 — audition expressive alternatives

User goal: try different interpretations without losing the current one.

Best pattern:

- select phrase,
- generate retakes,
- preview each in place,
- compare with original,
- apply only pitch, only timing, only timbre, or all.

### Flow 4 — tune a repeated chorus fast

User goal: propagate useful settings across sections.

Best pattern:

- copy/paste vocal settings across groups,
- save reusable expression presets,
- apply lane presets to selected regions,
- link repeated phrases optionally,
- allow break-link for local changes.

This directly addresses public user requests around copy-paste and faster repeated edits.

### Flow 5 — micro-edit and replay

User goal: tweak, replay same bar, tweak again.

Best pattern:

- playhead return on stop,
- sticky loop,
- pre-roll toggle,
- instant phrase-only replay,
- audition selection shortcut.

If this loop is not frictionless, the whole product feels slow no matter how good the synthesis is.

---

## 10. Browser-specific UX opportunities

A browser-first singing tool has limitations, but it also has a few unusual UX advantages.

### Advantage 1 — frictionless entry

Users can open a project link or demo in seconds. That makes onboarding, templates, and collaboration previews easier than desktop-only tools.

### Advantage 2 — progressive asset loading

A browser app can start with a thin shell and pull models, voices, and optional tools on demand. The UI can treat heavy capabilities as installable modules instead of initial clutter.

### Advantage 3 — better empty states

NN/g notes:

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.”

This is especially powerful in a browser context, where the app may initially have no downloaded voice, no project, and no cached audio.

Recommended empty states:

- **No project loaded:** show template choices and import options.
- **No voice installed:** explain voice packs and offer one-click starter voice.
- **No phrase selected:** show quick actions relevant to the current track.
- **No render yet:** show how preview vs final rendering works.
- **No audio permission / MIDI unavailable:** clear browser-specific guidance.

### Advantage 4 — inline docs and examples

Because help content can live in the same shell, browser products can embed mini tutorials, hover demos, and example projects without forcing the user into PDFs or external docs.

---

## 11. Latency UX is a product feature, not a fallback

Jakob Nielsen’s classic response-time thresholds still matter:

- around **0.1 seconds** feels instantaneous,
- around **1 second** keeps flow mostly uninterrupted,
- around **10 seconds** risks losing attention.

A browser singing tool often lands in the 1–10 second zone for meaningful synthesis work. That means the app must be designed for **productive waiting**.

NN/g’s summary on complex applications is directly relevant:

> “5 guidelines help users tolerate the long waits and frequent interruptions that are typical of complex workflows.”

### Product implication

While a phrase renders, the user should still be able to:

- edit another track,
- type lyrics,
- scrub existing audio,
- queue another render,
- inspect retakes already generated,
- and continue arranging.

### Recommended latency patterns

#### A. Two-tier rendering

- Draft preview renders automatically.
- Final-quality renders are explicit and batchable.

#### B. Phrase-local invalidation

Only the edited phrase becomes stale. Everything else remains playable.

#### C. Predictive pre-render

When the user stops editing for a beat, pre-render likely next actions:

- current phrase,
- neighboring phrase,
- selected retake candidate.

#### D. Transparent prioritization

Let users choose:

- render current selection first,
- render audible loop range,
- render all stale phrases in background.

#### E. Accurate progress language

Never say “almost done” unless you know that. Use honest stage labels instead.

---

## 12. Accessibility and inclusivity requirements

This category often ignores accessibility because it is seen as a pro tool. That is a mistake.

A browser-first product should aim to be better than incumbents in a few concrete ways.

### Essential accessibility requirements

- full keyboard navigation for transport, note nudging, and selection
- screen-reader labels for controls, state badges, and progress
- high-contrast theme and robust zoom
- non-color-only status signaling
- large enough note handles and lane targets
- reduced-motion option for animated cursors and loading indicators
- captions/text summaries for AI warnings and render errors

### Power-user accessibility is workflow accessibility

Apple’s keyboard guidance is relevant here:

> “Keyboard users often appreciate using keyboard shortcuts to speed up their interactions...”

In pro creative software, keyboard efficiency is not only an expert luxury. It is an accessibility feature for anyone minimizing strain, avoiding precision mousing, or working quickly.

### High-value shortcut targets

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

## 13. User feedback themes that should drive the roadmap

Across product reviews, manuals, and public community feedback, the same needs keep showing up.

### Theme 1 — Familiarity wins

Users repeatedly respond well to piano-roll and DAW-like paradigms because they reduce learning cost.

> “The familiar piano roll environment...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

### Theme 2 — Fine-grained pronunciation control matters

This is one of the clearest recurring praise points.

> “Phoneme editing is vastly superior.”

> “The phoneme timing panel... allows for easier control over the way different words are pronounced.”

### Theme 3 — AI must stay controllable

Users appreciate assistance, but not when it becomes hard to predict or steer.

> “Limitations on controllability and predictability...” — study on AI music-composition UX

### Theme 4 — Transparency builds trust

Not only around ethics, but around outputs and transformations.

> “Composers valued transparency in how variations evolve from the source material.”

### Theme 5 — Small workflow irritations are disproportionately expensive

Requests for better copy/paste, note nudging, playhead behavior, and locking may look minor, but they compound over every session.

### Theme 6 — Complexity is acceptable only when layered

Users will tolerate a deep tool if the first-run view is legible and advanced editing is progressively disclosed.

---

## 14. Recommended feature-to-pattern mapping

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

## 15. UX blueprint for the MVP

The MVP should not try to expose every parameter. It should prove the workflow.

### MVP screen design

#### Top bar

- project name
- save status
- undo/redo
- transport
- loop toggle
- render selection
- voice picker
- model/cache status

#### Left sidebar

- project navigator
- track list
- templates
- assets / installed voices

#### Center

- arrangement mini-map on top
- piano roll below
- inline lyrics on notes
- optional one visible lane at a time under notes

#### Right inspector

Tabbed:

- Voice
- Note
- Pronunciation
- Retakes
- Render

#### Bottom drawer

- mixer
- render queue
- warnings/log

### MVP interaction goals

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

## 16. UX blueprint for the full product

### Phase 1 — browser proof of workflow

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

### Phase 2 — serious editing

Goal: become usable for actual song sections.

Add:

- pronunciation editor
- direct pitch drawing
- note properties
- parameter lanes
- keyboard shortcuts
- looped audition
- phrase cache states

### Phase 3 — AI trust layer

Goal: make generation feel professional, not random.

Add:

- retake tray
- scoped regeneration
- locks
- A/B compare
- provenance chips
- preview/final quality distinction

### Phase 4 — arrangement-grade workspace

Goal: compete with standalone editors on daily usability.

Add:

- multi-track arrangement
- mixer drawer
- track colors and grouping
- reusable presets
- linked chorus phrases
- batch rendering

### Phase 5 — pro depth

Goal: satisfy advanced vocal producers.

Add:

- frame-level expert controls
- speaker/style automation
- collaborative review links
- region comments
- advanced keyboard customization
- workspace presets

---

## 17. UX risk register

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

## 18. What “best-in-class” looks like

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

## 19. Final recommendation

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

## Appendix: quoted evidence used in this report

### Product and review signals

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

> “The green tinted user interface works with the familiar piano roll environment and then utilizes clever tabs along the right side to open up specific parameters...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

### Manual and official workflow signals

> “Synthesizer V Studio allows a combination of automatic pitch generation by AI, direct editing of pitch curves, and manual pitch editing using parameters.” — Synthesizer V manual

> “The AI Retakes panel allows you to adjust the amount of variation in the pitch curves generated by the AI.” — Synthesizer V manual

> “In Direct Pitch Editing mode, edit the pitch curves directly on the Piano Roll.” — Synthesizer V manual

### Public user feedback signals

> “The workflow is improved, the phoneme editing is vastly superior.” — user comment, r/SynthesizerV

> “I love the new mouth opening parameter and the phoneme timing panel...” — user comment, r/SynthesizerV

> “Allow copy-paste of vocal mode settings between groups.” — user comment, r/SynthesizerV

> “Add shortcuts to nudge selected notes...” — user comment, r/SynthesizerV

> “Option to lock/unlock group positions...” — user comment, r/SynthesizerV

### UX and HCI signals

> “Direct manipulation is an interaction style in which UI elements are visible and can be acted upon via actions that receive immediate feedback.” — Nielsen Norman Group

> “The visibility of system status is a basic tenet of a great user experience.” — Nielsen Norman Group

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.” — Nielsen Norman Group

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.” — Nielsen Norman Group

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.” — Apple Human Interface Guidelines

### Human-AI music research signals

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.” — study on AI music-composition UX

> “Composers valued transparency in how variations evolve from the source material.” — study on composers evaluating an AI music tool

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output...” — study on composers evaluating an AI music tool
