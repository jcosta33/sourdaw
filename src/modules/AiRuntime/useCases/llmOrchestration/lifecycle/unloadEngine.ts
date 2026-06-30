import { isNativeEngineReady } from '../../../repositories/nativeEngine/isNativeEngineReady';
import { stopNativeEngine } from '../../../repositories/nativeEngine/stopNativeEngine';
import { unloadWebLlmEngine } from '../../../repositories/webLlm/unloadWebLlmEngine';
import { llmStatusStore } from '../../../stores/llmStatusStore';

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
