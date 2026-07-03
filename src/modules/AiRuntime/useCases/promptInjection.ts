/**
 * Prompt injection injector.
 *
 * The voice command overlay and other sources call `injectPromptCommand`
 * to push transcribed or generated text into the PromptBar.
 * The PromptBar subscribes via `onPromptInjection`.
 *
 * This is a cross-module concern — lives in useCases/ so both the
 * AiRuntime and Workspace modules can import it.
 */

import { promptInjectionListeners } from './promptInjectionState';

export function injectPromptCommand(text: string): void {
    for (const listener of promptInjectionListeners) {
        listener(text);
    }
}
