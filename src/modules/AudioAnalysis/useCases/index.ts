// AudioAnalysis/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAnalysisHandlers } from './getAnalysisHandlers';
export { setMixAnalysisDisplayLifecycle } from './setMixAnalysisDisplayLifecycle';

export { isAudioGenerationAvailable } from './audioAi/isAudioGenerationAvailable';
export { generateAudio } from './audioAi/generateAudio';
export { separateStems } from './audioAi/separateStems';

export type { AudioFeatures, AudioFeaturesSummary, AnalysisOptions } from './audioFeatures';
export { summarizeFeatures } from './audioFeatures';

export type { AudioToMidiOptions } from './audioToMidi';
export { audioToMidi } from './audioToMidi';
export type { DetectedOnset } from './detectOnsets';
export { detectOnsets } from './detectOnsets';

export type { InsertPolyphonicMidiNotesResult } from './insertPolyphonicMidiNotes';
export { insertPolyphonicMidiNotes } from './insertPolyphonicMidiNotes';

export { detectKey } from './keyDetection';

export type { PitchResult, PitchTrackingOptions } from './pitchDetection';
export { detectDominantPitch } from './pitchDetection';

export type { PolyphonicAudioToMidiOptions, PolyphonicAudioToMidiResult } from './polyphonicAudioToMidi';
export { polyphonicAudioToMidi } from './polyphonicAudioToMidi';

export { analyzeMix as analyzeMixFromTrackLayout } from './referenceMixComparison/analyzeMix/analyzeMix';

export { compareToReference } from './referenceMixComparison/compareToReference';

export { detectTempo } from './tempoDetection';
