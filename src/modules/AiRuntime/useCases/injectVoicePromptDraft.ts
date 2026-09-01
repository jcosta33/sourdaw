import { injectPromptDraft } from './injectPromptDraft';

/** Adds final dictation text to the prompt draft only; it never submits or executes. */
export function injectVoicePromptDraft(text: string): void {
    injectPromptDraft(text);
}
