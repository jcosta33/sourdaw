import { clearCloudApiKey } from '../../repositories/cloudLlm/clearCloudApiKey';
import { llmStatusStore } from '../../stores/llmStatusStore';

/**
 * Remove the cloud API key and disable the cloud backend.
 */
export function removeCloudApi(): void {
    clearCloudApiKey();
    if (llmStatusStore.value?.state === 'ready' && llmStatusStore.value.backend === 'cloud') {
        llmStatusStore.set({ state: 'idle' });
    }
}
