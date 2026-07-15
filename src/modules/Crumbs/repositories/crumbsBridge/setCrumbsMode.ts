import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

import type { CrumbsMode } from '../../models/CrumbsTypes';

export async function setCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('set_crumbs_mode', { instanceId, mode });
}
