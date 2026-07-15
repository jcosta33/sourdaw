import { ensureTauri } from './helpers';
import { invokeCrumbs } from './invokeCrumbs';

import type { CrumbsLoadResult } from '../../models/CrumbsTypes';

export async function loadSample(instanceId: string, filePath: string): Promise<CrumbsLoadResult> {
    ensureTauri('load_sample');
    const result = await invokeCrumbs('load_sample', { instanceId, filePath });
    return result as CrumbsLoadResult;
}
