import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function createCrumbsInstance(instanceId: string, sampleRate: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('create_crumbs', { instanceId, sampleRate });
}
