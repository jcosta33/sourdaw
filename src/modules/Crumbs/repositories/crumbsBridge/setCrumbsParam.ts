import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function setCrumbsParam(instanceId: string, param: string, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_crumbs_param', { instanceId, param, value });
}
