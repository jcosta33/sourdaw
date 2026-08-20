import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function stopRecording(instanceId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('stop_recording', { instanceId });
}
