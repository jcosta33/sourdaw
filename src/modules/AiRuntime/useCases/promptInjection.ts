/**
 * Prompt injection event bus.
 *
 * The voice command overlay and other sources call `injectPromptCommand`
 * to push transcribed or generated text into the PromptBar.
 * The PromptBar subscribes via `onPromptInjection`.
 *
 * This is a cross-module concern — lives in useCases/ so both the
 * AiRuntime and Workspace modules can import it.
 */

// §60.1 — Use a Set inside a holder so the binding can't be reassigned
// from outside this file and the unsubscribe path is O(1) instead of
// allocating a filtered copy.
const injectionBus: { listeners: Set<(text: string) => void> } = {
    listeners: new Set(),
};

export const onPromptInjection = (cb: (text: string) => void): (() => void) => {
    injectionBus.listeners.add(cb);
    return () => {
        injectionBus.listeners.delete(cb);
    };
};

export const injectPromptCommand = (text: string): void => {
    for (const listener of injectionBus.listeners) {
        listener(text);
    }
};
