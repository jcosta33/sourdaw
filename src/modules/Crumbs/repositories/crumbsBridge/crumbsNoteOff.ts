import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function crumbsNoteOff(instanceId: string, note: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('crumbs_note_off', { instanceId, note });
}
