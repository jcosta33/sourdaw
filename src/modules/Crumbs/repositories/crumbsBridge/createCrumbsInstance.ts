import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function createCrumbsInstance(instanceId: string, sampleRate: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('create_crumbs', { instanceId, sampleRate });
}
