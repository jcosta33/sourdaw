import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function crumbsNoteOff(instanceId: string, auditionId: number): Promise<void> {
    if (!isDesktopRuntime()) return;
    await desktopInvoke('crumbs_pad_audition_off', { instanceId, auditionId });
}
