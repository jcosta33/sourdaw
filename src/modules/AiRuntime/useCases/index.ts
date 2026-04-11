// AiRuntime/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAiOrganizationHandlers } from './getAiOrganizationHandlers';

export {
    getMixAnalysisStoreValue,
    setMixAnalysisStoreValue,
    NATIVE_MODEL_INFO,
    WEBLLM_MODEL_INFO,
    CLOUD_MODEL_INFO,
    WEBLLM_MODELS,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    getActiveModelId,
    PATTERN_TEMPLATES,
    filterTemplates,
    streamCloudChatCompletion,
    readLevels,
    readFrequencyBalance,
    detectIssues,
    generateSuggestions,
    generateWebLlmCompletion,
    generateNativeCompletion,
    isNativeEngineReady,
    isComplexPrompt,
} from './aiRuntimeQueries';
export type {
    MixAnalysisState,
    ModelInfo,
    FuzzyResult,
    MixAnalysis,
    MixIssue,
} from './aiRuntimeQueries';

export { configureCloudApi, removeCloudApi, isCloudAvailable } from './cloudApiManagement';

export { getProjectContext } from './getProjectContext';
export type { ProjectContext, ProjectContextClip, ProjectContextDevice, ProjectContextTrack } from './getProjectContext';

export {
    resolveBackend,
    isDsoBackendAvailable,
    isLlmAvailable,
    getBackendChain,
} from './llmOrchestration/backendResolution';

export { generateToolCalls } from './llmOrchestration/inference';

export { initEngine, unloadEngine } from './llmOrchestration/lifecycle';

export { generateMentorLessons } from './musicMentor/generateLessons';

export {
    notifyAiChange,
    subscribeAiChangeNotification,
} from './notifyAiChange';
export type { AiChangeNotification } from './notifyAiChange';

export { parsePromptToActions } from './parsePromptToActions';

export { onPromptInjection, injectPromptCommand } from './promptInjection';

export { runAiActionWithToast } from './runAiActionWithToast';
export type { AiActionToastMessages } from './runAiActionWithToast';

export { toggleVoiceInput, onVoiceToggle } from './voiceToggle';
