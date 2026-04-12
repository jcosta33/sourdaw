import { tauriInvoke, isTauri } from '#/utils/tauriBridge';
import { type PluginParameter } from './types';

export async function getPluginParameters(instanceId: string): Promise<PluginParameter[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_plugin_parameters', { instanceId }) as Promise<PluginParameter[]>;
}
