import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';
import { type PluginGuiInfo } from './types';

export async function openPluginGui(instanceId: string): Promise<PluginGuiInfo> {
    if (!isTauri()) {
        return { has_gui: false, is_open: false, width: 0, height: 0 };
    }
    return tauriInvoke('open_plugin_gui', { instanceId }) as Promise<PluginGuiInfo>;
}
