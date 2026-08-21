// AiRuntime/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export {
    aiActionHistoryStore,
    pushAiActionGroup,
    markGroupReverted,
    toggleAiHistoryPanel,
    clearAiHistory,
} from './aiActionHistoryStore';
export type { AiActionEntry, AiActionGroup, AiActionHistoryState } from './aiActionHistoryStore';

export { aiBackendPreferenceStore } from './aiBackendPreferenceStore';

export { llmStatusStore } from './llmStatusStore';
export type { LlmEngineStatus } from './llmStatusStore';

export { hostedLlmProviderStatusStore } from './hostedLlmProviderStatusStore';

export { voiceStatusStore } from './voiceStatusStore';
export type { VoiceStatus } from './voiceStatusStore';

export { voiceInputAvailabilityStore } from './voiceInputAvailabilityStore';
export type { VoiceInputAvailability } from './voiceInputAvailabilityStore';
