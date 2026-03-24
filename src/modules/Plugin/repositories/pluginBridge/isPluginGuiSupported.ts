import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

export async function isPluginGuiSupported(instanceId: string): Promise<boolean> {
    if (!isTauri()) {
        return false;
    }
    return tauriInvoke('is_plugin_gui_supported', { instanceId }) as Promise<boolean>;
}
