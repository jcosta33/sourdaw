import { promptInjectionListeners } from './promptInjectionState';

export function onPromptInjection(listener: (text: string) => void): () => void {
    promptInjectionListeners.add(listener);
    return () => {
        promptInjectionListeners.delete(listener);
    };
}
