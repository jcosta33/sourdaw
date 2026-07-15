import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function stopRecording(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('stop_recording', { instanceId });
}
