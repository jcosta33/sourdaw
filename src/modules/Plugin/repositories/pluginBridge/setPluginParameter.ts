import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function setPluginParameter(instanceId: string, paramId: number, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_parameter', { instanceId, paramId, value });
}
