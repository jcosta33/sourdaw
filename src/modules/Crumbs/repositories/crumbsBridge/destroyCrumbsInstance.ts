import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function destroyCrumbsInstance(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('destroy_crumbs', { instanceId });
}
