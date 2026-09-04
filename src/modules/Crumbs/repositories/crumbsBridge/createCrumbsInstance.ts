import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function createCrumbsInstance(instanceId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('create_crumbs', { instanceId });
}
