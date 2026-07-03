// AiRuntime/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAiOrganizationHandlers } from './getAiOrganizationHandlers';
export { mixHealthAnalysis } from './mixHealthAnalysis';

export { NATIVE_MODEL_INFO, CLOUD_MODEL_INFO, WEBLLM_MODELS, isComplexPrompt } from './aiRuntimeQueries/helpers';
export { getActiveModelId } from './aiRuntimeQueries/getActiveModelId';
export { streamCloudChatCompletion } from './aiRuntimeQueries/streamCloudChatCompletion';
export { generateWebLlmCompletion } from './aiRuntimeQueries/generateWebLlmCompletion';
export { generateNativeCompletion } from './aiRuntimeQueries/generateNativeCompletion';
export { isNativeEngineReady } from './aiRuntimeQueries/isNativeEngineReady';
export { searchPresets } from './aiRuntimeQueries/searchPresets';
export { getAvailablePresets } from './aiRuntimeQueries/getAvailablePresets';
export { resolvePresetActions } from './aiRuntimeQueries/resolvePresetActions';
export { PATTERN_TEMPLATES } from './aiRuntimeQueries/PATTERN_TEMPLATES';
export { filterTemplates } from './aiRuntimeQueries/filterTemplates';
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
export { isLlmAvailable } from './llmOrchestration/backendResolution/isLlmAvailable';

export { generateToolCalls } from './llmOrchestration/inference';

export { initEngine } from './llmOrchestration/lifecycle/initEngine';
export { unloadEngine } from './llmOrchestration/lifecycle/unloadEngine';

export { notifyAiChange } from './notifyAiChange';
export type { AiChangeNotification } from './notifyAiChange';

export { parsePromptToActions } from './parsePromptToActions';

export { onPromptInjection } from './onPromptInjection';
export { injectPromptCommand } from './promptInjection';

export { runAiActionWithToast } from './runAiActionWithToast';
export type { AiActionToastMessages } from './runAiActionWithToast';

export { isVoiceInputAvailable } from './voiceInput/isVoiceInputAvailable';
export { toggleVoiceInput } from './voiceToggle/toggleVoiceInput';
export { setVoiceToggleEventBus } from './voiceToggle/voiceToggleEventBus';
