import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function crumbsNoteOn(instanceId: string, note: number, velocity: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('crumbs_note_on', { instanceId, note, velocity });
}
