import { unloadWebLlmEngine } from '../../../repositories/webLlm/unloadWebLlmEngine';
import { llmStatusStore } from '../../../stores/llmStatusStore';

/** Unload the browser model and return the runtime to idle. */
export function unloadEngine(): void {
    unloadWebLlmEngine();
    llmStatusStore.set({ state: 'idle' });
}
