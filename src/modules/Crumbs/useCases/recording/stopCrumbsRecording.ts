import { stopRecording } from '../../repositories/crumbsBridge';

export async function stopCrumbsRecording(instanceId: string): Promise<void> {
    await stopRecording(instanceId);
}