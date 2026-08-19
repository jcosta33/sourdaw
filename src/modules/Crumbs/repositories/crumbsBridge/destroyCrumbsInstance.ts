import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function destroyCrumbsInstance(instanceId: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('destroy_crumbs', { instanceId });
}
