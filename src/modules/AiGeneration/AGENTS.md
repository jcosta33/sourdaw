# AiGeneration module — Agent Guidelines

AI-assisted musical pattern generation (chords, melodies, drum patterns, basslines, fills, transitions, variations, completion) and native audio denoising; does not own LLM execution runtimes (AiRuntime), browser neural inference workers (BrowserAi), or project timeline state directly.

## Public Contract Surface

- `useCases`: `handleAiDenoiseClip`, `handleGenerateMidiPrompt`, `removeTask`, `cancelProcessingTask`, `toggleAiPanel`, `applyChordProgressionToTrack`, `applyDrumPatternToTrack`, `applyMelodyToTrack`, `generateMidiVariations`, `denoiseAudio`, `getAiMidiHandlers`, `getGenerationHandlers`, `MIDI_TRANSFORM_IMPLEMENTATIONS`.
- `stores`: `aiStore` (`AiTaskType`, `AiTaskStatus`, `AiTaskResult`, `AiState`).
- `presentations/views`: `PatternBrowser`.
- Handlers: `getAiMidiHandlers`, `getGenerationHandlers`.

## Key Subsystems

- **Pattern Engines & Libraries**: Algorithmic and style-based pattern generators in `services/MidiPatternLibrary.ts` and `services/Patterns/*` (bass, chords, drums, melodies).
- **LLM Note Transforms**: Parsing and normalizing structured model responses into `GeneratedNote` arrays (`handlers/aiMidi/llmNoteHelpers.ts`).
- **Async Task Tracking**: `stores/aiStore.ts` manages asynchronous task lifecycles, progress reports, and cancellation tokens.
- **Native AI Bridge**: `repositories/nativeAIBridge` handles desktop IPC invocation for heavy native tasks such as audio denoising.

## Invariants & Traps

- Generated musical data must be validated against timeline boundaries and valid MIDI pitch/velocity ranges before being applied to tracks via commands.
- Asynchronous tasks must update `aiStore` status on cancellation or failure to prevent hanging UI progress states.
- Do not import directly from private inference worker internals; access generation capabilities through registered use cases.
- This module supplies MIDI transform implementations and never the contract: the names, the parameter schemas and their bounds belong to Command, and bootstrap hands the implementation map to Command's registry. An adapter passes every argument through explicitly, seed included, and throws on a value outside its domain rather than clamping or defaulting — the contract already validated it, so a value that reaches an adapter out of domain means the two sides drifted, and the caller turns that throw into a refusal ([ADR 0043](../../../.agents/decisions/0043-midi-transforms-compile-to-add-notes-through-the-command-registry.md)).

## Verification

```bash
pnpm vitest run src/modules/AiGeneration
```
