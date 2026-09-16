# AudioAnalysis module — Agent Guidelines

Audio analysis runtime: extracts musical features, detects pitch/key/tempo, drives audio-to-MIDI transcription, and interfaces with stem separation AI services.

## Domain Ownership

Owns audio feature extraction, pitch/key/tempo detection, monophonic/polyphonic audio-to-MIDI transcription, stem separation service client integration, and reference mix comparison. Does not own WebAudio graph processing or live playback (AudioEngine), arrangement structure (Arrangement), or MIDI sequence persistence (MIDI / CrdtDocument).

## Public Contract Surface

- **`useCases`**: `getAnalysisHandlers`, `setMixAnalysisDisplayLifecycle`, `separateStems`, `isStemSeparationAvailable`, `summarizeFeatures`, `analyzeAgentRenderReceipt`, `audioToMidi`, `detectOnsets`, `insertPolyphonicMidiNotes`, `detectKey`, `describeDetectedKey`, `detectDominantPitch`, `polyphonicAudioToMidi`, `analyzeCurrentMix`, `compareToReference`, `detectTempo`.
- **`events`**: None.
- **`stores`**: None.
- **`presentations/views`**: None.
- **Handler maps**: `getAnalysisHandlers`.

## Key Subsystems

- **`services/`**: Chroma extraction (`chromaFromSamples.ts`, `chromaFlatness.ts`), key correlation profiles (`keyProfileCorrelation.ts`), spectral balance and level analyzers (`mixAnalysisHelpers.ts`, `readFrequencyBalance.ts`, `readLevels.ts`).
- **`repositories/`**: Remote stem separation and Audio AI server connectivity (`isAudioAiServerRunning.ts`, `separateStems.ts`, `isStemSeparationAvailable.ts`).
- **`models/`**: Feature metrics and pitch representations (`MixComparisonTypes.ts`, `PitchTypes.ts`).
- **`handlers/`**: Production command handlers (`handleAnalyzeMix.ts`, `handleAudioToMidi.ts`, `handleAutoFixMix.ts`, `handleCompareToReference.ts`, `handleDetectKey.ts`, `handleDetectTempo.ts`).

## Invariants & Traps

- **Off-thread computation**: All analysis algorithms (FFT, autocorrelation, chroma correlation, onset detection) operate asynchronously on decoded audio buffers/PCM, never on the real-time audio thread.
- **External AI service degradation**: Stem separation relies on an optional local/remote Audio AI server; availability must always be checked via `isStemSeparationAvailable` before initiating network tasks.
- **Non-destructive feature processing**: Transcription and analysis outputs generate new data (transcribed MIDI notes, mix analysis metrics) without modifying source audio buffers in `audioBufferCache`.
- **Receipts never estimate**: an objective analysis receipt reports a metric only when it read it from the audio; a metric it cannot measure is a typed `unavailable` entry naming the reason, never a plausible number, and every receipt is bound to the content address and source revision of the render it measured.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/AudioAnalysis`
- **Module boundaries**: `pnpm deps:validate`
