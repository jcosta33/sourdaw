import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function stopRecording(instanceId: string, takeId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    if (!/^[1-9][0-9]*$/u.test(takeId) || BigInt(takeId) > 18446744073709551615n) {
        throw new TypeError('Invalid Crumbs stop take id');
    }
    await desktopInvoke('stop_recording', { instanceId, takeId });
}
