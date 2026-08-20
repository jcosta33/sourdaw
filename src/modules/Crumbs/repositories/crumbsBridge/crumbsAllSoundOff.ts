import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function crumbsAllSoundOff(instanceId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('crumbs_all_sound_off', { instanceId });
}
