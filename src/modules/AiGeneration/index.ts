// stores/aiStore.ts
export type { AiTaskType, AiTaskStatus, AiTaskResult, AiState } from './stores/aiStore';
export { aiStore, subscribeAiStore, getAiSnapshot } from './stores/aiStore';

// useCases/actions/handleAiDenoiseClip.ts
export { handleAiDenoiseClip } from './useCases/actions/handleAiDenoiseClip';

// useCases/actions/handleGenerateAudioFallback.ts
export { handleGenerateAudioFallback } from './useCases/actions/handleGenerateAudioFallback';

// useCases/actions/handleGenerateMidiPrompt.ts
export { handleGenerateMidiPrompt } from './useCases/actions/handleGenerateMidiPrompt';

// useCases/actions/handleStemSeparationPreview.ts
export { handleStemSeparationPreview } from './useCases/actions/handleStemSeparationPreview';

// useCases/actions/removeTask.ts
export { removeTask } from './useCases/actions/removeTask';

// useCases/actions/toggleAiPanel.ts
export { toggleAiPanel } from './useCases/actions/toggleAiPanel';

// useCases/aiMidiHandlers.ts
export { aiMidiHandlers } from './useCases/aiMidiHandlers';

// useCases/generateChordProgression/applyToTrack.ts
export { applyChordProgressionToTrack } from './useCases/generateChordProgression/applyToTrack';

// useCases/generateDrumPattern/applyToTrack.ts
export { applyDrumPatternToTrack } from './useCases/generateDrumPattern/applyToTrack';

// useCases/generateMelody/applyToTrack.ts
export { applyMelodyToTrack } from './useCases/generateMelody/applyToTrack';

// useCases/generateMidiVariations.ts
export { generateMidiVariations } from './useCases/generateMidiVariations';

// useCases/generationHandlers.ts
export { generationHandlers } from './useCases/generationHandlers';
