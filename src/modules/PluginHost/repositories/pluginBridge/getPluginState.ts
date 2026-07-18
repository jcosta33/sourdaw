import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function getPluginState(instanceId: string): Promise<number[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_plugin_state', { instanceId }) as Promise<number[]>;
}
