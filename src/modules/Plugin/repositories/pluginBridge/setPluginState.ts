import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function setPluginState(instanceId: string, state: number[]): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_state', { instanceId, pluginState: state });
}
