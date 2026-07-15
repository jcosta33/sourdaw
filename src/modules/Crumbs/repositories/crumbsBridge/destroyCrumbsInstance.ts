import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function destroyCrumbsInstance(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('destroy_crumbs', { instanceId });
}
