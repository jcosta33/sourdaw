import { tauriInvoke } from '#/utils/tauriBridge';

import { ensureTauri } from './helpers';

export async function getCrumbsPosition(instanceId: string): Promise<number> {
    ensureTauri('get_crumbs_position');
    const result = await tauriInvoke('get_crumbs_position', { instanceId });
    return result as number;
}
