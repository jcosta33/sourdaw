import { voicePromptDraftListeners } from './promptInjectionState';

/** Subscribe to draft-only dictation text. */
export function onVoicePromptDraft(listener: (text: string) => void): () => void {
    voicePromptDraftListeners.add(listener);
    return () => voicePromptDraftListeners.delete(listener);
}
