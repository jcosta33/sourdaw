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

let injectionListeners: Array<(text: string) => void> = [];

export const onPromptInjection = (cb: (text: string) => void): (() => void) => {
    injectionListeners.push(cb);
    return () => {
        injectionListeners = injectionListeners.filter((l) => l !== cb);
    };
};

export const injectPromptCommand = (text: string): void => {
    for (const listener of injectionListeners) {
        listener(text);
    }
};
