// AudioAnalysis/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAnalysisHandlers } from './getAnalysisHandlers';

export {
    isStemSeparationAvailable,
    isAudioGenerationAvailable,
    isAudioAiServerRunning,
    generateAudio,
    separateStems,
} from './audioAi';

export type { AudioFeatures, AudioFeaturesSummary, AnalysisOptions } from './audioFeatures';
export { extractFeatures, summarizeFeatures } from './audioFeatures';

export type { AudioToMidiOptions, DetectedOnset } from './audioToMidi';
export { detectOnsets, audioToMidi } from './audioToMidi';

export type { InsertPolyphonicMidiNotesResult } from './insertPolyphonicMidiNotes';
export { insertPolyphonicMidiNotes } from './insertPolyphonicMidiNotes';

export { detectKey } from './keyDetection';

export { mixHealthAnalysis } from './mixHealthAnalysis';

export type { PitchResult, PitchTrackingOptions } from './pitchDetection';
export { trackPitch, detectDominantPitch } from './pitchDetection';

export type { PolyphonicAudioToMidiOptions, PolyphonicAudioToMidiResult } from './polyphonicAudioToMidi';
export { polyphonicAudioToMidi } from './polyphonicAudioToMidi';

export { analyzeMix } from './analyzeMix';

export { createReferenceAnalysis, analyzeMix as analyzeMixFromTrackLayout } from './referenceMixComparison/analyzeMix';

export { compareMixes, compareToReference } from './referenceMixComparison/compareMixes';

export { detectTempo } from './tempoDetection';
