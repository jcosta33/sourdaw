/**
 * AiRuntime Queries — use case layer exposing AiRuntime state
 * to cross-module consumers.
 */

import { mixAnalysisStore } from '../stores/mixAnalysisStore';
import { NATIVE_MODEL_INFO, WEBLLM_MODEL_INFO, CLOUD_MODEL_INFO, WEBLLM_MODELS, type ModelInfo } from '../models/ModelInfo';
import { searchPresets, getAvailablePresets, type FuzzyResult } from '../services/fuzzySearch';
import { type IntentResult } from '../models/IntentResult';
import { type PresetCategory, type PresetContext } from '../models/presetActions/registry';

export type MixAnalysisState = NonNullable<typeof mixAnalysisStore.value>;
export { NATIVE_MODEL_INFO, WEBLLM_MODEL_INFO, CLOUD_MODEL_INFO, WEBLLM_MODELS, searchPresets, getAvailablePresets };
export type { ModelInfo, FuzzyResult, IntentResult, PresetCategory, PresetContext };
export { getActiveModelId } from '../repositories/webLlm/engineLifecycle';
export type { MixAnalysis, MixIssue } from '../models/MixAnalysis';
export { PATTERN_TEMPLATES, filterTemplates } from '../models/midiPatternLibrary';

/** Get the mix analysis store value. */
export function getMixAnalysisStoreValue(): typeof mixAnalysisStore.value {
    return mixAnalysisStore.value;
}

/** Set the mix analysis store value. */
export function setMixAnalysisStoreValue(state: MixAnalysisState): void {
    mixAnalysisStore.set(state);
}

// ─── Cross-module re-exports ───────────────────────────────────────────────────

export { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference';
export { readLevels } from '../repositories/mixAnalysis/readLevels';
export { readFrequencyBalance } from '../repositories/mixAnalysis/readFrequencyBalance';
export { detectIssues, generateSuggestions } from '../transformers/mixAnalysisTransformers';
export { generateWebLlmCompletion } from '../repositories/webLlm/engineLifecycle';
export { generateNativeCompletion } from '../repositories/nativeEngine/completions';
export { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';
export { isComplexPrompt } from '../transformers/promptParser/parsing';
