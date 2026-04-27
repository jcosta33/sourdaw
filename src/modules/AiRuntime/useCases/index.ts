// AiRuntime/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAiOrganizationHandlers } from './getAiOrganizationHandlers';
export { mixHealthAnalysis } from './mixHealthAnalysis';

export { getMixAnalysisStoreValue } from './aiRuntimeQueries/getMixAnalysisStoreValue';
export { setMixAnalysisStoreValue } from './aiRuntimeQueries/setMixAnalysisStoreValue';
export {
    NATIVE_MODEL_INFO,
    CLOUD_MODEL_INFO,
    WEBLLM_MODELS,
    getActiveModelId,
    streamCloudChatCompletion,
    generateWebLlmCompletion,
    generateNativeCompletion,
    isNativeEngineReady,
    isComplexPrompt,
} from './aiRuntimeQueries/helpers';
export { searchPresets } from './aiRuntimeQueries/searchPresets';
export { getAvailablePresets } from './aiRuntimeQueries/getAvailablePresets';
export { resolvePresetActions } from './aiRuntimeQueries/resolvePresetActions';
export { PATTERN_TEMPLATES } from './aiRuntimeQueries/PATTERN_TEMPLATES';
export { filterTemplates } from './aiRuntimeQueries/filterTemplates';
export type { MixAnalysisState } from './aiRuntimeQueries/setMixAnalysisStoreValue';
export type { ModelInfo, MixAnalysis, MixIssue } from './aiRuntimeQueries/helpers';
export type { FuzzyResult } from './aiRuntimeQueries/searchPresets';

export { configureCloudApi } from './cloudApiManagement/configureCloudApi';
export { removeCloudApi } from './cloudApiManagement/removeCloudApi';
export { isCloudAvailable } from './cloudApiManagement/isCloudAvailable';

export { getProjectContext } from './getProjectContext';
export type {
    ProjectContext,
    ProjectContextClip,
    ProjectContextDevice,
    ProjectContextTrack,
} from './getProjectContext';

export { resolveBackend } from './llmOrchestration/backendResolution/helpers';
export { isDsoBackendAvailable } from './llmOrchestration/backendResolution/isDsoBackendAvailable';
export { isLlmAvailable } from './llmOrchestration/backendResolution/isLlmAvailable';
export { getBackendChain } from './llmOrchestration/backendResolution/getBackendChain';

export { generateToolCalls } from './llmOrchestration/inference';

export { initEngine } from './llmOrchestration/lifecycle/initEngine';
export { unloadEngine } from './llmOrchestration/lifecycle/unloadEngine';

export { generateMentorLessons } from './musicMentor/generateLessons';

export { notifyAiChange, subscribeAiChangeNotification } from './notifyAiChange';
export type { AiChangeNotification } from './notifyAiChange';

export { parsePromptToActions } from './parsePromptToActions';

export { onPromptInjection, injectPromptCommand } from './promptInjection';

export { runAiActionWithToast } from './runAiActionWithToast';
export type { AiActionToastMessages } from './runAiActionWithToast';

export { toggleVoiceInput } from './voiceToggle/toggleVoiceInput';
export { onVoiceToggle } from './voiceToggle/onVoiceToggle';
