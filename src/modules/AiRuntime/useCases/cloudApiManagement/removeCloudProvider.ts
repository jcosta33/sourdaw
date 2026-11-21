import { clearCloudProviderConfig } from '../../repositories/cloudLlm/clearCloudProviderConfig';
import { answeringStatus } from '../../stores/answeringStatus';

export async function removeCloudProvider(): Promise<void> {
    await clearCloudProviderConfig();
    const engineStatus = answeringStatus.readEngineStatus();
    if (engineStatus?.state === 'ready' && engineStatus.backend === 'cloud') {
        answeringStatus.publishEngineStatus({ state: 'idle' });
    }
}
