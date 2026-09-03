import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';

export async function stopCrumbsRecording(instanceId: string): Promise<void> {
    await stopRecording(instanceId);
}
