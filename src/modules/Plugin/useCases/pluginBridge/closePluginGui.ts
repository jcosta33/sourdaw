import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

export async function closePluginGui(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('close_plugin_gui', { instanceId });
}
