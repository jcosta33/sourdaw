// useCases/getAnalysisHandlers.ts
export { getAnalysisHandlers } from './useCases/getAnalysisHandlers';

// useCases/audioAi.ts
export {
    isStemSeparationAvailable,
    isAudioGenerationAvailable,
    isAudioAiServerRunning,
    generateAudio,
    separateStems,
} from './useCases/audioAi';

// useCases/audioFeatures.ts
export type { AudioFeatures, AudioFeaturesSummary, AnalysisOptions } from './useCases/audioFeatures';
export { extractFeatures, summarizeFeatures } from './useCases/audioFeatures';

// useCases/audioToMidi.ts
export type { AudioToMidiOptions, DetectedOnset } from './useCases/audioToMidi';
export { detectOnsets, audioToMidi } from './useCases/audioToMidi';

// useCases/insertPolyphonicMidiNotes.ts
export type { InsertPolyphonicMidiNotesResult } from './useCases/insertPolyphonicMidiNotes';
export { insertPolyphonicMidiNotes } from './useCases/insertPolyphonicMidiNotes';

// useCases/keyDetection.ts
export { detectKey } from './useCases/keyDetection';

// useCases/mixHealthAnalysis.ts
export { mixHealthAnalysis } from './useCases/mixHealthAnalysis';

// useCases/pitchDetection.ts
export type { PitchResult, PitchTrackingOptions } from './useCases/pitchDetection';
export { trackPitch, detectDominantPitch } from './useCases/pitchDetection';

// useCases/polyphonicAudioToMidi.ts
export type { PolyphonicAudioToMidiOptions, PolyphonicAudioToMidiResult } from './useCases/polyphonicAudioToMidi';
export { polyphonicAudioToMidi } from './useCases/polyphonicAudioToMidi';

// useCases/analyzeMix.ts (mix panel / metering)
export { analyzeMix } from './useCases/analyzeMix';

// useCases/referenceMixComparison/analyzeMix.ts
export { createReferenceAnalysis, analyzeMix as analyzeMixFromTrackLayout } from './useCases/referenceMixComparison/analyzeMix';

// useCases/referenceMixComparison/compareMixes.ts
export { compareMixes, compareToReference } from './useCases/referenceMixComparison/compareMixes';

// useCases/tempoDetection.ts
export { detectTempo } from './useCases/tempoDetection';
