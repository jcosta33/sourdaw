import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function crumbsNoteOn(instanceId: string, note: number, velocity: number): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('crumbs_note_on', { instanceId, note, velocity });
}
