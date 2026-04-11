import { armRecording } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';

export async function armSamplerRecording(
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    await armRecording(state.instanceId, threshold, targetPad, maxDurationSecs);
}