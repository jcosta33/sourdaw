import { promptDraftListeners } from './promptInjectionState';

/** Subscribes the canonical Prompt Bar draft admission used by every text source. */
export function onPromptDraft(listener: (text: string) => void): () => void {
    promptDraftListeners.add(listener);
    return () => promptDraftListeners.delete(listener);
}
