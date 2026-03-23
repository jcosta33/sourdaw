import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

export async function setPluginState(instanceId: string, state: number[]): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_state', { instanceId, state });
}
