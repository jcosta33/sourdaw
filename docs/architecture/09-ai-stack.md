# AI Stack Architecture

Sourdaw is AI-native in three distinct senses: it runs language models (browser and hosted runtimes), it runs generative and analytical audio ML (cloud and in-browser), and — the part that makes it a DAW feature rather than a chatbot — model output can _act on the project_ through the same write path humans use. This document maps that stack.

It complements:

- `CRDT & Collaboration Architecture` — the write path AI actions enter
- The `llm-action-bridge` agent skill — rules for model-driven actions
- `src-tauri/AGENTS.md` — desktop-shell boundaries

---

## 1. Language model runtimes

Browser and hosted runtimes behind one panel (AiRuntime):

| Runtime                                                                                                    | Where               | Use                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| Anthropic cloud                                                                                            | `@anthropic-ai/sdk` | Default chat completion, streaming (`streamCloudChatCompletion.ts`) |
| WebLLM                                                                                                     | `@mlc-ai/web-llm`   | In-browser inference, no API key (`generateWebLlmCompletion.ts`)    |
| Voice input runs through whisper-rs dictation (`speech.rs`: load model, start/stop dictation, ASR status). |

Automatic language-model selection uses browser WebLLM only and fails closed without WebGPU. Hosted providers require explicit selection, preserving the remote-data disclosure boundary.

## 2. Audio ML

**Native (ONNX via `ort`):** DeepFilterNet denoise and Demucs stem separation (`ai_audio.rs`), plus audio post-processing (rubato/hound resampling in `audio_postprocess.rs`).

**In-browser (BrowserAi):** Kokoro TTS, DiffSinger singing-voice synthesis, and RAVE timbre transfer, executed through ONNX Runtime Web in a dedicated worker (`workers/onnxInferenceWorker.ts`) with a model download registry (`initBrowserAi.ts`). BrowserAi initializes non-blocking at bootstrap.

**Analysis (AudioAnalysis):** key/tempo/onset/pitch detection (`meyda`, `pitchy`), audio→MIDI via Spotify's basic-pitch, browser-side stem separation preview, mix-vs-reference comparison.

## 3. The action bridge — AI that does things

The load-bearing design decision: model output never touches state directly. The bridge:

```
model output
   │  structured action proposals (typed, named)
   ▼
validation (structure, bounds, ID existence, capability)
   │  pendingActionConfirmationStore — user confirms risky/bulk actions
   ▼
runAppAction → executeAppAction          AiRuntime/useCases/aiPanelActions/
   │  same Automerge transaction as human input
   ▼
aiActionHistoryStore                     revert of AI-initiated actions
```

Because execution shares the human write path, AI actions get undo, persistence, collaboration merge, and audit history for free — and `undoLastAction.ts` can revert them through the dedicated AI action history. `confirmPendingChatActions.ts` gates destructive or bulk proposals behind explicit confirmation.

The operational rules for building on this bridge (registry discipline, plan/execute separation, validation, observability) live in the `llm-action-bridge` skill.

## 4. Module map

| Module        | Owns                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| AiRuntime     | LLM runtimes, chat panel, voice commands, action execution + AI action history, preset search |
| AiGeneration  | generative MIDI (melody/drums/chords/variations), denoise/stem-sep previews, AI task queue    |
| BrowserAi     | in-browser ML models (TTS, SVS, timbre transfer), model registry, ONNX worker                 |
| AudioAnalysis | musical analysis and audio→MIDI                                                               |

External dependency ownership is deliberate: `@anthropic-ai/sdk` and `@mlc-ai/web-llm` appear only in AiRuntime; `onnxruntime-web` only in BrowserAi and AudioAnalysis; `@spotify/basic-pitch`/`meyda`/`pitchy` only in AudioAnalysis.

## References

- `.agents/skills/llm-action-bridge/SKILL.md` — rules for model-driven actions
- `src-tauri/AGENTS.md` — desktop-shell command inventory
- `docs/architecture/06-crdt-collaboration.md` — the write path actions enter
