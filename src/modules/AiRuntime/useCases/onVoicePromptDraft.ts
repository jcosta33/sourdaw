import { onPromptDraft } from './onPromptDraft';

/** Subscribe to draft-only dictation text. */
export function onVoicePromptDraft(listener: (text: string) => void): () => void {
    return onPromptDraft(listener);
}
