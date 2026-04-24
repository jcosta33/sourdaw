// AudioAnalysis/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAnalysisHandlers } from './getAnalysisHandlers';

export { isStemSeparationAvailable } from './audioAi/isStemSeparationAvailable';
export { isAudioGenerationAvailable } from './audioAi/isAudioGenerationAvailable';
export { isAudioAiServerRunning } from './audioAi/isAudioAiServerRunning';
export { generateAudio } from './audioAi/generateAudio';
export { separateStems } from './audioAi/separateStems';

export type { AudioFeatures, AudioFeaturesSummary, AnalysisOptions } from './audioFeatures';
export { extractFeatures, summarizeFeatures } from './audioFeatures';

export type { AudioToMidiOptions, DetectedOnset } from './audioToMidi';
export { detectOnsets, audioToMidi } from './audioToMidi';

export type { InsertPolyphonicMidiNotesResult } from './insertPolyphonicMidiNotes';
export { insertPolyphonicMidiNotes } from './insertPolyphonicMidiNotes';

export { detectKey } from './keyDetection';

export type { PitchResult, PitchTrackingOptions } from './pitchDetection';
export { trackPitch, detectDominantPitch } from './pitchDetection';

export type { PolyphonicAudioToMidiOptions, PolyphonicAudioToMidiResult } from './polyphonicAudioToMidi';
export { polyphonicAudioToMidi } from './polyphonicAudioToMidi';

export { createReferenceAnalysis } from './referenceMixComparison/analyzeMix/createReferenceAnalysis';
export { analyzeMix as analyzeMixFromTrackLayout } from './referenceMixComparison/analyzeMix/analyzeMix';

export { compareMixes, compareToReference } from './referenceMixComparison/compareMixes';

export { detectTempo } from './tempoDetection';
