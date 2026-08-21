# AI Stack Architecture

Sourdaw runs language models, audio ML, and model-driven project actions.

It complements:

- `CRDT & Collaboration Architecture` — the write path AI actions enter
- The `llm-action-bridge` agent skill — rules for model-driven actions
- `crates/sourdaw-native/AGENTS.md` — native command-body boundaries

---

## 1. Language model runtimes

AiRuntime owns two explicit runtime classes:

| Runtime          | Boundary                             | Use                                                                                   |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| WebLLM           | Browser worker via `@mlc-ai/web-llm` | Architecture retained; exact model artifacts withheld                                 |
| Hosted providers | Desktop native gateway               | Anthropic, OpenAI, and OpenAI-compatible inference through opaque credential sessions |

Voice input runs through whisper-rs dictation in `speech.rs`.

No browser language model is admitted in this release. Hosted providers require the desktop app and
explicit selection. Native code reads fixed `SOURDAW_*_API_KEY` environment
variables; the renderer receives only an opaque session ID. Web builds expose no hosted credential
surface. Unauthenticated loopback OpenAI-compatible endpoints carry no credential and remain local.

## 2. Audio ML

**Native:** first-party downward-expander denoise (`ai_audio.rs`) plus audio post-processing
(`audio_postprocess.rs`). Neither path loads a model artifact.

**In-browser (BrowserAi):** Kokoro TTS runs through a dedicated worker and model registry. Its model
and exposed voices are revision-pinned and SHA-256 verified. DDSP admits only the exact Magenta
checkpoint artifacts pinned by URL, size, and SHA-256 in the catalog. DDSP downloads reject
redirects, and readiness comes from the versioned OPFS generation index plus the exact ready marker
and artifacts. Rendering runs in the TF.js worker only after it confirms WebGPU. The Magenta
checkpoint permission record and the TensorFlow.js Apache notices are separate; Sourdaw does not
claim that the checkpoint weights are Apache-licensed. RAVE and singing synthesis stay withheld
until exact model chains pass admission. BrowserAi initializes non-blocking at bootstrap.

**Analysis (AudioAnalysis):** key/tempo/onset/pitch detection (`meyda`, `pitchy`), audio→MIDI via the
admitted Spotify Basic Pitch package, and mix-vs-reference comparison. Stem separation stays
unavailable until a compatible model passes admission.

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
| AiGeneration  | generative MIDI (melody/drums/chords/variations), denoise previews, AI task queue             |
| BrowserAi     | in-browser ML models (TTS and timbre transfer), model registry, inference workers             |
| AudioAnalysis | musical analysis and audio→MIDI                                                               |

External dependency ownership is deliberate: `@mlc-ai/web-llm` appears only in AiRuntime;
`onnxruntime-web` only in BrowserAi and AudioAnalysis; `@spotify/basic-pitch`, `meyda`, and `pitchy`
only in AudioAnalysis. Hosted provider transport lives in `sourdaw-native`.

## References

- `.agents/skills/llm-action-bridge/SKILL.md` — rules for model-driven actions
- `.agents/decisions/0028-native-provider-credential-sessions.md` — hosted credential boundary
- `.agents/decisions/0030-exact-model-release-admission.md` — model artifact admission
- `crates/sourdaw-native/AGENTS.md` — native command-body boundaries
- `docs/architecture/06-crdt-collaboration.md` — the write path actions enter
