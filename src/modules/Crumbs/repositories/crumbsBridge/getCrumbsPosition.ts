import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureNative } from './helpers';

export async function getCrumbsPosition(instanceId: string): Promise<number> {
    ensureNative('get_crumbs_position');
    const result = await desktopInvoke('get_crumbs_position', { instanceId });
    return result as number;
}
