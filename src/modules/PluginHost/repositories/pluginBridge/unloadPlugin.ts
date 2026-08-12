import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function unloadPlugin(instanceId?: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('unload_plugin', instanceId === undefined ? {} : { instanceId });
}
