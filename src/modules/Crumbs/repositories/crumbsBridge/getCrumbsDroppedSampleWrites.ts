import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureNative } from './helpers';

/**
 * How many sample writes the instance's fixed pool budget has refused. The
 * count refreshes once per rendered block, so a read may lag the load that
 * tripped it by one drain — the warning it feeds is a surface, not a meter.
 */
export async function getCrumbsDroppedSampleWrites(instanceId: string): Promise<number> {
    ensureNative('get_crumbs_dropped_sample_writes');
    const result = await desktopInvoke('get_crumbs_dropped_sample_writes', { instanceId });
    return result as number;
}
