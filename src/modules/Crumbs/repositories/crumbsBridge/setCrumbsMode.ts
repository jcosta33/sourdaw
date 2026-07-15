import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import type { CrumbsMode } from '../../models/CrumbsTypes';

export async function setCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_crumbs_mode', { instanceId, mode });
}
