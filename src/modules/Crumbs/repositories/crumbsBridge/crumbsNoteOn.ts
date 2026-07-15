import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function crumbsNoteOn(instanceId: string, note: number, velocity: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('crumbs_note_on', { instanceId, note, velocity });
}
