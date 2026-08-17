// AudioAnalysis/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAnalysisHandlers } from './getAnalysisHandlers';
export { setMixAnalysisDisplayLifecycle } from './setMixAnalysisDisplayLifecycle';

export { separateStems } from './audioAi/separateStems';

export { summarizeFeatures } from './summarizeFeatures';

export { audioToMidi } from './audioToMidi';
export { detectOnsets } from './detectOnsets';

export { insertPolyphonicMidiNotes } from './insertPolyphonicMidiNotes';

export { detectKey } from './keyDetection';
export { describeDetectedKey } from './describeDetectedKey';

export { detectDominantPitch } from './pitchDetection';

export { polyphonicAudioToMidi } from './polyphonicAudioToMidi';

export { analyzeMix as analyzeMixFromTrackLayout } from './referenceMixComparison/analyzeMix/analyzeMix';

export { compareToReference } from './referenceMixComparison/compareToReference';

export { detectTempo } from './tempoDetection';
