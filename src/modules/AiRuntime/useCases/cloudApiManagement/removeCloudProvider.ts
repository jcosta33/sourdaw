import { clearCloudProviderConfig } from '../../repositories/cloudLlm/clearCloudProviderConfig';
import { llmStatusStore } from '../../stores/llmStatusStore';

export async function removeCloudProvider(): Promise<void> {
    await clearCloudProviderConfig();
    if (llmStatusStore.value?.state === 'ready' && llmStatusStore.value.backend === 'cloud') {
        llmStatusStore.set({ state: 'idle' });
    }
}
