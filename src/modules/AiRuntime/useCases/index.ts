// AiRuntime/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { getAiOrganizationHandlers } from './getAiOrganizationHandlers';
export { mixHealthAnalysis } from './mixHealthAnalysis';
export { streamHostedModelText } from './streamHostedModelText';
export { beginMixAnalysis } from './beginMixAnalysis';
export { completeMixAnalysis } from './completeMixAnalysis';
export { failMixAnalysis } from './failMixAnalysis';
export { setVoiceStatus } from './setVoiceStatus';
export { setVoiceListeningStatus } from './setVoiceListeningStatus';
export { setVoiceTranscribingStatus } from './setVoiceTranscribingStatus';
export { toggleAiHistoryPanel } from './toggleAiHistoryPanel';
export { recordAiActionGroup } from './recordAiActionGroup';

export { NATIVE_MODEL_INFO, WEBLLM_MODELS } from './aiRuntimeQueries/modelInfo';
export { isComplexPrompt } from './aiRuntimeQueries/isComplexPrompt';
export { getActiveModelId } from './aiRuntimeQueries/getActiveModelId';
export { streamCloudChatCompletion } from './aiRuntimeQueries/streamCloudChatCompletion';
export { generateWebLlmCompletion } from './aiRuntimeQueries/generateWebLlmCompletion';
export { generateNativeCompletion } from './aiRuntimeQueries/generateNativeCompletion';
export { isNativeEngineReady } from './aiRuntimeQueries/isNativeEngineReady';
export { searchPresets } from './aiRuntimeQueries/searchPresets';
export { getAvailablePresets } from './aiRuntimeQueries/getAvailablePresets';
export { resolvePresetActions } from './aiRuntimeQueries/resolvePresetActions';

export { configureCloudApi } from './cloudApiManagement/configureCloudApi';
export { configureCloudProvider } from './cloudApiManagement/configureCloudProvider';
export { getConfiguredCloudProvider } from './cloudApiManagement/getConfiguredCloudProvider';
export { removeCloudApi } from './cloudApiManagement/removeCloudApi';
export { isCloudAvailable } from './cloudApiManagement/isCloudAvailable';

export { getProjectContext } from './getProjectContext';
export { getAiRuntimeProtocolContracts } from './getAiRuntimeProtocolContracts';

export { resolveBackend } from './llmOrchestration/backendResolution/helpers';
export { isNativeAiRuntimeAvailable } from './llmOrchestration/backendResolution/isNativeAiRuntimeAvailable';
export { isLlmAvailable } from './llmOrchestration/backendResolution/isLlmAvailable';
export { setAiBackendPreference } from './llmOrchestration/backendResolution/setAiBackendPreference';

export { generateToolCalls } from './llmOrchestration/generateToolCalls';
export { getMidiNoteGenerationToolSchemas } from './getMidiNoteGenerationToolSchemas';
export { requireMidiNoteGenerationToolCall } from './requireMidiNoteGenerationToolCall';

export { initEngine } from './llmOrchestration/lifecycle/initEngine';
export { unloadEngine } from './llmOrchestration/lifecycle/unloadEngine';

export { notifyAiChange } from './notifyAiChange';
export { describePlannedAction } from './describePlannedAction';

export { parsePromptToActions } from './parsePromptToActions';
export { planPromptActions } from './planPromptActions';
export { executePlannedActions } from './executePlannedActions';
export { executePromptActionGroup } from './executePromptActionGroup';
export { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';

export { onPromptInjection } from './onPromptInjection';
export { injectPromptCommand } from './promptInjection';

export { runAiActionWithToast } from './runAiActionWithToast';

export { isVoiceInputAvailable } from './voiceInput/isVoiceInputAvailable';
export { toggleVoiceInput } from './voiceToggle/toggleVoiceInput';
export { setVoiceToggleEventBus } from './voiceToggle/voiceToggleEventBus';
export { getAgentExecutionModeAuthority } from './getAgentExecutionModeAuthority';
export { getAgentExecutionModeFailure } from './getAgentExecutionModeFailure';
export { resolveAgentExecutionMode } from './resolveAgentExecutionMode';
export { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
export { agentRunCancellation } from './cancelAgentRun';
export { agentRunLifecycle } from './agentRunLifecycle';
export { recoverInterruptedAgentRuns } from './agentRunRecovery';
export { agentRunWorkLease } from './agentRunWorkLease';
export { normalizeAgentFailure } from './agentErrorAndSaga';
export { admitAgentRetry } from './admitAgentRetry';
export { admitBoundedAgentCorrection } from './admitBoundedAgentCorrection';
export { createAgentSagaStep } from './createAgentSagaStep';
export { agentRunControls } from './getAgentRunControlProjection';
export { deleteAgentRunArtifacts } from './deleteAgentRunArtifacts';
export { getAgentRunSagaProjection } from './getAgentRunSagaProjection';
