import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export async function closePluginGui(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('close_plugin_gui', { instanceId });
}
