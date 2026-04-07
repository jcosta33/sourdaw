/**
 * Recording use case — SP-404 style threshold-triggered capture.
 */

import { armRecording, stopRecording } from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';

export async function armSamplerRecording(
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    await armRecording(state.instanceId, threshold, targetPad, maxDurationSecs);
}

export async function stopSamplerRecording(): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    await stopRecording(state.instanceId);
}
