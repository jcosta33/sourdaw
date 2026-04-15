import { armRecording } from '../../repositories/crumbsBridge';

export async function armCrumbsRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    await armRecording(instanceId, threshold, targetPad, maxDurationSecs);
}