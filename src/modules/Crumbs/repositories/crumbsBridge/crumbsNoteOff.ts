import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function crumbsNoteOff(instanceId: string, note: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('crumbs_note_off', { instanceId, note });
}
