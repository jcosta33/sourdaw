import { promptDraftListeners } from './promptInjectionState';

/** Adds final dictation text to the prompt draft only; it never submits or executes. */
export function injectVoicePromptDraft(text: string): void {
    for (const listener of promptDraftListeners) {
        listener(text);
    }
}
