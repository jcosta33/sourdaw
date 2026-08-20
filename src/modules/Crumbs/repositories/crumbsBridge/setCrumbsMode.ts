import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import type { CrumbsMode } from '../../models/CrumbsTypes';

export async function setCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('set_crumbs_mode', { instanceId, mode });
}
