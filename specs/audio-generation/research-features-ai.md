# AI in music production: Consolidated Research & Codebase Audit

_This document consolidates research from `ai-implementation.md`, `ai-ux.md`, `llm.md`, and `llm-ammendment.md`. Features already fully implemented (WebLLM, mistral.rs, Demucs, Basic Pitch, EASE Encoding, Qwen3-8B mandate) have been removed. What remains are the missing or diverging features, annotated with findings from the WebDAW codebase._

---

## 1. Rust-Tier Analysis (BPM, Key, Pitch)

The research recommends a hybrid approach: Web tier for real-time analysis (via Essentia or MIT alternatives), and a Rust tier for offline/heavy fallback analysis.

**Original Spec:**

- **BPM/beat detection:** `Essentia.js` / `bpm-analyzer` crate.
- **Key detection:** `Essentia.js` / `stratum-dsp` crate.
- **Pitch detection:** `CREPE tiny ONNX` / `pitch-detection` crate.

## 2. Intelligent DSP (AI EQ, Mastering, Gain Staging)

The research emphasizes non-ML "AI" features based on computational auditory perception and spectral matching.

**Original Spec:**

- **AI-assisted EQ with "learn" pattern:** Compute average magnitude spectrum over multiple frames using `realfft` → smooth into ~31 bands → compare target vs reference → generate EQ curve.
- **Reference-based mastering/matching:** Matchering algorithm (pure DSP) matching RMS, frequency response, peak amplitude, and stereo width.
- **Intelligent gain staging:** Auto-gain, loudness targeting (LUFS), and dynamic range analysis using EBU R128.

**Codebase Annotation:**
_While `realfft` is present in the Rust backend's `Cargo.lock`, none of these features are implemented. There is no UI for an EQ "Learn" button, no reference slot for mastering, and no LUFS/EBU R128 auto-gain compensation._

## 3. Dedicated ML Models vs LLM-Only Generation

The research suggests using specific ML models for tasks like MIDI generation and browser-side audio analysis.

**Original Spec:**

- **Transformers.js (`@huggingface/transformers`):** ML models in the browser for tasks like automatic speech recognition (Whisper).
- **Magenta.js (`@magenta/music`):** MIDI generation (MusicVAE, MusicRNN) for sampling novel melodies and continuing sequences.
- **Cloud APIs:** Claude (Anthropic), OpenAI, Replicate (for heavy models like Demucs/MusicGen).

**Codebase Annotation:**
_Neither `@huggingface/transformers` nor `@magenta/music` are present in `package.json`. The codebase routes AI MIDI generation entirely through the primary LLM (mistral.rs/WebLLM) using the DSO editor (e.g., `src/modules/AiGeneration/useCases/llmMidiGeneration.ts`). **SUPERIOR METHOD:** Codebase - Consolidating MIDI generation through the primary LLM via structured prompting is superior for maintainability and reduces application bundle size compared to importing a heavy, dedicated ML framework like Magenta.js. Modern LLMs are highly capable of structural generation, making the dual-model approach redundant. For Cloud APIs, only `@anthropic-ai/sdk` is installed; OpenAI and Replicate are missing._

## 4. Preview-Then-Commit UX (Ghost Rendering)

The research heavily emphasizes a "Preview-Then-Commit" UI pattern to preserve user agency and build trust.

**Original Spec:**

- **Ghost Track Pattern:** AI-proposed changes should appear as previews before final commit. This includes semi-transparent clips, proposed automation overlays, ghost notes in MIDI editor, provisional routing overlays, and staged mixer changes.

**Codebase Annotation:**
_The DSO Editor implements the lifecycle correctly (there are `confirmPreview` and `cancelPreview` actions in `PromptBar.tsx`). `PianoRollRenderer.ts` successfully implements `drawGhostNotes` for MIDI note suggestions. However, the ghost track pattern is only partially implemented: ghost rendering for Audio clips, Routing changes, and Automation overlays does not exist in the codebase._
