import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureNative } from './helpers';

import type { CrumbsLoadResult } from '../../models/CrumbsTypes';

export async function loadSample(instanceId: string, filePath: string): Promise<CrumbsLoadResult> {
    ensureNative('load_sample');
    const result = await desktopInvoke('load_sample', { instanceId, filePath });
    return result as CrumbsLoadResult;
}
