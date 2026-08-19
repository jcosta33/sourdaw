import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function createCrumbsInstance(instanceId: string, sampleRate: number): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('create_crumbs', { instanceId, sampleRate });
}
