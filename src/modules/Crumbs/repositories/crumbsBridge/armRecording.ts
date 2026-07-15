import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function armRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('arm_recording', { instanceId, threshold, targetPad, maxDurationSecs });
}
