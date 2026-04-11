import { llmStatusStore } from '../../../stores/llmStatusStore';
import { isNativeEngineReady, stopNativeEngine } from '../../../repositories/nativeEngine/lifecycle';
import { unloadWebLlmEngine } from '../../../repositories/webLlm/engineLifecycle';

/**
 * Unload the current engine and free memory.
 */
export async function unloadEngine(): Promise<void> {
    if (isNativeEngineReady()) {
        await stopNativeEngine();
    }
    unloadWebLlmEngine();
    llmStatusStore.set({ state: 'idle' });
}