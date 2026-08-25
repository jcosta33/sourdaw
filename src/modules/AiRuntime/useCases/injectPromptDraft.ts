import { promptDraftListeners } from './promptInjectionState';

/** Seeds the canonical Prompt Bar draft; only explicit user submit starts a run. */
export function injectPromptDraft(text: string): void {
    for (const listener of promptDraftListeners) {
        listener(text);
    }
}
