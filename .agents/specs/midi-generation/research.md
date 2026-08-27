---
type: research
id: RESEARCH-midi-generation
title: Symbolic-MIDI generation via local inference
status: open
owner: The Sourdaw team
sources:
    - 'Question: what is the most viable local architecture for Session-Players-class MIDI generation?'
---

# Research: Symbolic-MIDI generation via local inference

## Question

What is the most viable architecture for a local, offline "Session Players"-class
symbolic-MIDI generator in a cross-platform DAW — which models, tokenizers, and runtime — and
what product behaviours must it inherit?

## Findings

### R-001 — A tiered rule + transformer architecture is the viable shape

- **Claim:** The strongest path is a rule-based core (instant, deterministic), a small-model enhancement layer (GrooVAE humanization), and a 20–360M-parameter transformer for chord-conditioned accompaniment; a 360M model generates 4–8 bars in under 3 s on consumer hardware.
- **Evidence:** Band-in-a-Box shipped commercial-quality rule-based MIDI for two decades; GrooVAE (Magenta, CC BY 4.0) humanizes in <100 ms; Anticipatory Music Transformer (Thickstun et al., 2023) generation timings.
- **Confidence:** high
- **Bears on:** the pipeline tiering and the rule-engine-as-producer call site.

### R-002 — Anticipatory Music Transformer is the top neural candidate

- **Claim:** AMT (128M/360M/780M, Apache-2.0) conditions on control events via an anticipation mechanism (lookahead δ), making it the best fit for chord-track-driven accompaniment; it does not accept symbolic chord labels and needs a chord-to-voicing layer.
- **Evidence:** Thickstun et al. 2023; standard `GPT2LMHeadModel` exportable via `optimum`; MLC-quantized HF mirrors exist.
- **Confidence:** medium
- **Bears on:** AC-001/AC-002/AC-009 and the licensing open question.

### R-003 — `ort` (ONNX Runtime) is the runtime, with KV-cache mandatory

- **Claim:** The `ort` crate runs symbolic-MIDI models with per-platform execution providers; KV-cache turns O(n²) decoding into O(n), ~50× faster, at ~50–200 MB cache for a 360M model.
- **Evidence:** `ort` adopters (HuggingFace TEI, Google Magika); `Session` is `Send + Sync`.
- **Confidence:** high
- **Bears on:** AC-003/AC-004 (audio-thread isolation, spawn_blocking) and the memory open question.

### R-004 — Tokenizer diversity (REMI+ and arrival-time) is required

- **Claim:** REMI+ encodes a metrical grid with a 168-entry chord vocabulary (chord-first work); AMT requires absolute arrival-time encoding. Both are needed, not one scheme.
- **Evidence:** MidiTok REMI/REMI+ implementation backed by Symusic; AMT arrival-time triplets at 10 ms resolution.
- **Confidence:** high
- **Bears on:** AC-001 (round-trip fidelity).

### R-005 — Logic Pro Session Players criticism pins three product rules

- **Claim:** Conservative default complexity, non-destructive (regenerable) MIDI, and chord-tone constraint at high complexity are required to avoid the documented Logic Pro failure modes.
- **Evidence:** user reports ("pull complexity way down"; "more wrong notes at higher complexity"; loss of regeneration on conversion).
- **Confidence:** medium
- **Bears on:** AC-006 (provenance) and AC-009 (chord-tone filter).

### R-006 — License safety excludes copyleft / NC weights

- **Claim:** Only Apache-2.0, MIT, and CC-BY (non-NC) weights are shippable; MusicLang (GPL-3.0) and unclear-license models (MIDI-GPT per its paper) are excluded from v1.
- **Evidence:** model license survey across AMT, Composer's Assistant v2, MIDI-GPT, SkyTNT, MusicLang.
- **Confidence:** high
- **Bears on:** AC-008 (registry license allowlist).

### R-007 — The current generator is LLM-backed; specialized local inference remains research

- **Claim:** The current MIDI path uses structured prompting in
  `src/modules/AiGeneration/useCases/llmMidiGeneration.ts`, resolving browser-local WebLLM or a
  configured hosted provider and falling back to built-in pattern templates. The supported hosted
  routes are Anthropic, OpenAI, and OpenAI-compatible providers. There is no native local language
  model route. Magenta.js (`@magenta/music`, MusicVAE/MusicRNN), `@huggingface/transformers`, and
  `ort` are not package dependencies. The rule-plus-transformer and `ort` pipeline in this research
  is therefore an unadmitted future experiment, not a description of the current runtime.
- **Evidence:** the current generator source and `package.json` (`@mlc-ai/web-llm` and
  `@anthropic-ai/sdk` are present; Magenta, Transformers.js, and Replicate are absent).
- **Confidence:** high
- **Bears on:** migration sequencing, bundle/licensing tradeoffs, and the boundary between the
  current prompt path and the local inference contract; it adds no v1 dependency.

### R-008 — Keep the LLM path as the baseline until local inference proves its value

- **Claim:** Structured LLM generation remains the maintainable, bundle-light default. Do not add
  Magenta.js or Transformers.js merely to duplicate capabilities already served by the LLM path.
  A dedicated local pipeline is justified only when it delivers a measured offline,
  deterministic, latency, or musical-quality advantage; its models must be optional rather than a
  second always-loaded generation stack.
- **Evidence:** the current structured-prompt implementation already covers generation without a
  dedicated framework dependency, while the proposed local architecture introduces model weights,
  tokenizers, runtime integration, and memory costs.
- **Confidence:** high for the dependency decision; medium until local quality and latency
  benchmarks establish whether the planned pipeline should replace or extend the LLM path.
- **Bears on:** migration gates, bundle size, model-download policy, and the go/no-go decision for
  the neural tier.

## Open questions

- [ ] Q-001 — Are MLC-quantized AMT weights legally shippable under Apache-2.0 for a commercial DAW (Lakh provenance)? Blocks the neural tier.
- [ ] Q-002 — Real residency of AMT-medium + acoustic models on 8 GB machines; optional-download vs RAM-gated.
- [ ] Q-003 — Per-feature CPU/GPU routing table once benchmarks land.
- [ ] Q-004 — When the local pipeline ships, should it replace or coexist with the current
      prompt-based generator? Preserve standard MIDI output and route any future cloud fallback
      through the AI trust/policy boundary rather than creating a second mutation path.

## Recommendation

Prototype the rule engine (Tier 1) and the AMT ONNX path (Tier 3) in parallel (R-001,
R-002), while treating the existing structured LLM path as the compatibility bridge (R-007);
standardise on `ort` with KV-cache (R-003) and two tokenizer adapters (R-004);
pin the three Logic-derived product rules at the pipeline layer (R-005); gate the model
registry on a commercial-safe license allowlist (R-006). The neural tier is blocked until
Q-001 is resolved in writing.

---

## Restored detail from `research/pipelines/midi-generation.md`

The sections below were dropped when this research note was migrated to the AC-format
findings above. They are restored verbatim from the original source
(`git show bb84b0e:research/pipelines/midi-generation.md`) because the summarised
findings R-001…R-006 collapsed away specifics the spec and downstream work depend on.

### Why parametric controls dominate over text prompts (restores R-LOST-1)

Every successful commercial system—Logic Pro, Band-in-a-Box, EZdrummer, Celemony Tonalic—uses parametric controls rather than text input. The reasons are structural, not merely aesthetic. **Sliders and XY pads enable real-time manipulation during playback**, producing sub-second feedback loops impossible with text-to-generation workflows. Specific parameter positions are **deterministic and reproducible**, encoded perfectly in project files—the same slider position always produces the same result. Producers develop **physical muscle memory** for parameter positions. Individual parameters like Ghost Notes or Hi-Hat openness allow **surgical adjustments** that natural language cannot express precisely. Academic research on text-to-music tools found "interpretive gaps often arise between the AI's output and the artist's intended vision," with producers reporting they had to modify their original ideas to accommodate unexpected model outputs.

That said, text conditioning has a role as a secondary interface. Models like text2midi and MuseCoco accept natural language descriptions translated to attribute tokens. The recommended approach is **parametric controls as the primary interface**, with optional natural-language presets that map to specific parameter configurations.

### The competitive landscape beyond Logic (restores R-LOST-4)

**Band-in-a-Box** (PG Music, since 1988) pioneered auto-accompaniment with chord chart input driving 5 backing tracks. Its pre-2007 engine was purely rule-based MIDI generation—proof that algorithmic approaches can achieve commercial quality. Post-2007 **RealTracks** replaced MIDI with recorded audio from 100+ session musicians, pitch-shifted via the élastique Pro engine. As of 2023, it offers **3,737+ RealTracks** and **822+ RealDrums** across 9,000+ styles. Its strength is breadth; its weakness is a widely criticized dated UI.

**Celemony Tonalic** (announced NAMM 2026) takes a radically different approach: neither AI, loops, nor MIDI. It uses Melodyne DNA technology to manipulate 7,000+ recorded performance patterns from 30+ session musicians, preserving harmonic relationships. It supports guitar, bass, drums, and percussion with note-level editing in the Studio edition.

**EZdrummer 3's Bandmate** analyzes audio/MIDI from any instrument via transient detection and suggests matching drum grooves from its library. **Steinberg Cubase** offers a Chord Track and Chord Assistant for composition but no auto-accompaniment generation. **Ableton Live 12** provides algorithmic MIDI generators (Seed, Rhythm, Shape, Euclidean) but no virtual musicians.

### Logic Pro Session Player parametric inventories (restores R-LOST-6)

Apple's Session Players—Drummer (2013), Bass Player and Keyboard Player (May 2024, Logic Pro 11), and Synth Player (2025, Logic Pro 12)—represent the most polished commercial implementation of parametric virtual musicians. Understanding their design is essential for building a competitive alternative.

**Drummer** uses an **XY pad** where the Y-axis controls dynamics (Loud/Soft) and the X-axis controls rhythmic complexity (Simple/Complex). A draggable yellow puck sets the global character. Beyond this, per-instrument toggles (Kick, Snare, Toms, Hi-Hat, Cymbals, Tambourine, Shaker) with individual complexity sliders allow surgical control. The Details panel exposes **Feel** (push/pull relative to the beat), **Ghost Notes** (syncopated low-velocity hits), **Hi-Hat** openness, **Swing** (8th or 16th-note shuffle), **Fills** amount, and **Humanize**. Seven genre categories (Rock, Alternative, Songwriter, R&B, Electronic, Hip Hop, Percussion) contain **28+ virtual drummer characters**, each with ~8 presets.

**Bass Player** follows the global Chord Track automatically, generating MIDI that drives the Studio Bass plugin. Its parameters include **Complexity**, **Intensity**, **Melody** (melodic movement), **Octaves**, **Phrasing**, **Lowest Note** (4-string vs. 5-string), **Blue Notes & Slaps**, **Double Stops**, **Laid Back/Feel**, and **Swing**. Patterns are visualized as 16th-note dot grids. Apple describes the technology as "trained in collaboration with today's best bass players using advanced AI and sampling technologies" with a "microsampling" system containing hundreds of thousands of individual nuanced sounds. The output is MIDI, convertible to standard regions for manual editing.

**Keyboard Player** offers **Left/Right hand toggles**, **Voicing** selection (block chords to extended harmony), **Grace Notes**, **Complexity**, **Intensity**, and **Dynamics**. Four main styles include "Freely" (improvisational) and "Block Chord." It follows the Chord Track with the same mechanism as the Bass Player.

The underlying technology is a **hybrid of rule-based algorithms and trained models** generating MIDI, not audio loops. Apple's John Danty confirmed: "The underlying technology is MIDI. So that allows us to go in and speak directly to the audio plugins that we have." The system was built by modeling how musicians play rather than extracting performances from recordings, which is why it "took an extraordinarily long time."

**Common criticisms** reveal design lessons: users report **default complexity is too high** ("the very first thing I do is pull complexity way down"); Session Player regions **cannot be directly note-edited** without converting to MIDI (losing regeneration capability); there is **no guitarist**; and the keyboard player produces **more wrong notes at higher complexity**. These point to the importance of conservative defaults, non-destructive MIDI workflows, and constraining output to chord tones at high complexity.

### Distinguishing findings for the four alternative neural models (restores R-LOST-2)

**Composer's Assistant v2** (Malandro, 2024, ISMIR) is the only model with a **complete working DAW integration** (REAPER scripts). It uses a T5-like encoder-decoder architecture trained exclusively on **permissively-licensed MIDI**—critical for commercial use. Version 2 adds rhythmic conditioning, note density control, and pitch constraints. It infills arbitrary (track, measure) pairs, supports all 128 MIDI instruments plus drums, and is fully open-source.

**MIDI-GPT** (Pasquier et al., 2025, AAAI) is a compact **~20M parameter** GPT-2-based model already integrated into Cubase and Ableton via the Calliope system. It offers attribute control tokens for instrument type, note density (10 bins), polyphony range, and duration range, inserted per-track before musical content. Its **Bar-Fill** representation—masking bars with `FILL_IN` tokens—is purpose-built for DAW infilling workflows. Trained on the **GigaMIDI** dataset (2.1M+ unique MIDI files).

**SkyTNT MIDI Model** (~250M parameters, Apache-2.0) is notable for having **ONNX models already exported** with KV-cache support in its HuggingFace repository. Multi-instrument generation with drum kit and key signature selection. The lowest-friction path to a working ONNX prototype.

**MusicLang v2** uses a LLaMA-2 architecture with **native chord conditioning** via a `predict_chords("Am CM Dm E7 Am")` API, trained on CC0-licensed Lakh MIDI. Its chord vocabulary supports standard qualities (M, m, 7, m7b5, sus2, sus4, M7, dim) with bass notes. The **GPL-3.0 license** is the main limitation for commercial DAW plugins.

#### Model comparison for implementation planning

| Model                   | Params | Chord conditioning | Multi-track     | ONNX ready   | License     | Best for                    |
| ----------------------- | ------ | ------------------ | --------------- | ------------ | ----------- | --------------------------- |
| **AMT (medium)**        | 360M   | Via note controls  | Native          | Exportable   | Apache-2.0  | Accompaniment generation    |
| **Composer's Asst. v2** | ~150M  | Via piano track    | 128 instruments | Exportable   | Open source | DAW infilling               |
| **MIDI-GPT**            | 20M    | Attribute tokens   | Native          | Exportable   | Unclear     | Lightweight, fast inference |
| **SkyTNT**              | ~250M  | Limited            | Native          | Already done | Apache-2.0  | Fastest ONNX prototype      |
| **MusicLang v2**        | Small  | Native string API  | Yes             | Exportable   | GPL-3.0     | Chord-first workflows       |

#### MIDI-RWKV deserves attention for edge deployment

A 2025 paper introduces **MIDI-RWKV**, using RWKV-7 (a linear-complexity alternative to transformers) for symbolic music infilling. Its **O(n) complexity** versus transformers' O(n²) means better scaling for long sequences on resource-constrained hardware. It uses MIDI-GPT's Bar-Fill representation. This architecture is worth monitoring as a future upgrade path for lower-end devices.

### Rule-engine algorithm specifics (restores R-LOST-7)

**For bass lines**, a chord-tone walking algorithm is highly effective: play the **root on beat 1**, **fifth on beat 3**, **third or seventh on beat 2** (ascending or descending motion), and a **chromatic approach note on beat 4** (half step above or below the root of the next chord). For pop/rock styles, simpler root-fifth or root-octave patterns with rhythmic variations suffice. These rules produce musically correct output with zero compute, instantly. The MaxHilsdorf Walking-Bass-Generator on GitHub implements this in under 500 lines of Python, trivially portable to Rust.

**For drums**, a probability-grid approach works well: define a 16-step grid per instrument (kick, snare, hi-hat, etc.) where each step has an activation probability and velocity distribution. Genre templates set the base probabilities (four-on-the-floor kick for house, beats 2 and 4 snare for rock). **Euclidean rhythms** (Bjorklund algorithm, ~30 lines of code) distribute k onsets across n steps as evenly as possible, producing patterns that map to real-world rhythms: E(3,8) is the Cuban tresillo, E(5,8) is the cinquillo, E(5,16) approximates bossa nova.

**For keyboard voicings**, rule-based voice leading (close voicing, drop-2, drop-3 inversions) combined with common comping patterns per genre produces solid results. Root-position block chords are the simplest starting point; adding rhythmic patterns (whole notes, quarter-note Alberti bass, eighth-note arpeggios) scales complexity with a single parameter.

### Mapping UI parameters to model conditioning (restores R-LOST-3)

Each user control maps to a specific encoding strategy:

**Complexity** (0.0–1.0) maps to **note density bins**. MIDI-GPT defines 10 per-instrument percentile bins, so `complexity × 10` selects the appropriate bin. Alternatively, for rule-based generation, complexity directly controls the number of notes per beat and rhythmic subdivision level.

**Intensity** (0.0–1.0) maps to **velocity range tokens** plus density modifiers. Higher intensity means louder dynamics (velocity bins) and more notes. For the AMT, this translates to higher pitch values in the note token encoding.

**Swing** (0–100%) is best handled as **post-processing**: generate on a straight quantization grid, then apply a deterministic timing offset to upbeat positions. No current model natively handles swing feel well. The offset formula is `upbeat_shift = swing_pct × triplet_offset`.

**Genre/Style** maps to either **attribute prefix tokens** (MIDI-GPT, MuseCoco) or model/checkpoint selection (genre-specific fine-tuned weights). For a rule-based layer, genre selects the pattern template library (rock, jazz, electronic, etc.).

**Temperature** controls sampling randomness during autoregressive generation. Lower values (0.7) produce conservative, predictable output; higher values (1.2) introduce creative variation. This is a pure inference parameter, not a token.

The FIGARO model (von Rütte et al., 2023) demonstrates the most comprehensive description-based conditioning: per-bar tokens specifying time signature, active instruments, chord, note density, mean pitch, mean velocity, and mean duration. This architecture allows bar-level control over all musical parameters and represents the upper bound of what conditioning can achieve.

### A specialized symbolic runtime is separate from the language-model stack (restores R-LOST-5)

A purpose-built music transformer with relative attention or custom tokenization does not belong in
the retired native language-model route. If this research is admitted later, it requires its own
specialized runtime decision, licensing proof, and performance evidence. It must not revive or
reuse a native Mistral language-model backend. Music models at 20–360M parameters are expected to
need **well under 1GB at FP16**, but that estimate is not an admission decision.
