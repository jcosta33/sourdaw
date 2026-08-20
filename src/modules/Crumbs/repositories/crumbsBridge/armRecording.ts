import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function armRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('arm_recording', { instanceId, threshold, targetPad, maxDurationSecs });
}
