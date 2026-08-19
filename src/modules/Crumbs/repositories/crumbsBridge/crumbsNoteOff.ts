import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function crumbsNoteOff(instanceId: string, note: number): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('crumbs_note_off', { instanceId, note });
}
