import { ensureTauri } from './helpers';
import { invokeCrumbs } from './invokeCrumbs';

import type { MeteringResult } from '../../models/CrumbsTypes';

export async function getCrumbsMetering(instanceId: string): Promise<MeteringResult> {
    ensureTauri('get_crumbs_metering');
    const result = await invokeCrumbs('get_crumbs_metering', { instanceId });
    return result as MeteringResult;
}
