// ── Views ─────────────────────────────────────────────────────────────────────
export { AiActionHistoryPanel } from './presentations/views/AiActionHistoryPanel';
export { AiChangeToast } from './presentations/views/AiChangeToast';
export { ChatPanel } from './presentations/views/ChatPanel';
export { GenerativeAiPanel } from './presentations/views/GenerativeAiPanel';
export { MixAnalysisPanel } from './presentations/views/MixAnalysisPanel';
export { VoiceCommandOverlay, isSpeechRecognitionAvailable } from './presentations/views/VoiceCommandOverlay';

// ── Stores ────────────────────────────────────────────────────────────────────
export {
    aiActionHistoryStore,
    pushAiActionGroup,
    markGroupReverted,
    toggleAiHistoryPanel,
    clearAiHistory,
} from './stores/aiActionHistoryStore';
export type { AiActionEntry, AiActionGroup, AiActionHistoryState } from './stores/aiActionHistoryStore';

export { llmStatusStore } from './stores/llmStatusStore';
export type { LlmEngineStatus } from './stores/llmStatusStore';

export { voiceStatusStore } from './stores/voiceStatusStore';
export type { VoiceStatus } from './stores/voiceStatusStore';

// ── Use Cases ─────────────────────────────────────────────────────────────────
export { getAiOrganizationHandlers } from './useCases/getAiOrganizationHandlers';

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
} from './useCases/aiRuntimeQueries';
export type {
    MixAnalysisState,
    ModelInfo,
    FuzzyResult,
    MixAnalysis,
    MixIssue,
} from './useCases/aiRuntimeQueries';

export { configureCloudApi, removeCloudApi, isCloudAvailable } from './useCases/cloudApiManagement';

export { getProjectContext } from './useCases/getProjectContext';
export type { ProjectContext, ProjectContextClip, ProjectContextDevice, ProjectContextTrack } from './useCases/getProjectContext';

export {
    resolveBackend,
    isDsoBackendAvailable,
    isLlmAvailable,
    getBackendChain,
} from './useCases/llmOrchestration/backendResolution';

export { generateToolCalls } from './useCases/llmOrchestration/inference';

export { initEngine, unloadEngine } from './useCases/llmOrchestration/lifecycle';

export { generateMentorLessons } from './useCases/musicMentor/generateLessons';

export {
    notifyAiChange,
    subscribeAiChangeNotification,
} from './useCases/notifyAiChange';
export type { AiChangeNotification } from './useCases/notifyAiChange';

export { parsePromptToActions } from './useCases/parsePromptToActions';

export { onPromptInjection, injectPromptCommand } from './useCases/promptInjection';

export { runAiActionWithToast } from './useCases/runAiActionWithToast';
export type { AiActionToastMessages } from './useCases/runAiActionWithToast';

export { toggleVoiceInput, onVoiceToggle } from './useCases/voiceToggle';
