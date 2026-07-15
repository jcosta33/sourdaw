import { tauriInvoke } from '#/utils/tauriBridge';

import { ensureTauri } from './helpers';

import type { CrumbsLoadResult } from '../../models/CrumbsTypes';

export async function loadSample(instanceId: string, filePath: string): Promise<CrumbsLoadResult> {
    ensureTauri('load_sample');
    const result = await tauriInvoke('load_sample', { instanceId, filePath });
    return result as CrumbsLoadResult;
}
