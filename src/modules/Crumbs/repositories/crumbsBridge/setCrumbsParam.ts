import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function setCrumbsParam(instanceId: string, param: string, value: number): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('set_crumbs_param', { instanceId, param, value });
}
