import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function setCrumbsParam(instanceId: string, param: string, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('set_crumbs_param', { instanceId, param, value });
}
