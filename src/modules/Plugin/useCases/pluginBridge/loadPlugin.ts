import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';
import { type PluginInstance } from './types';

export async function loadPlugin(pluginId: string, instanceId: string): Promise<PluginInstance> {
    if (!isTauri()) {
        return {
            instance_id: instanceId,
            plugin_id: pluginId,
            name: 'Unavailable',
            parameters: [],
            is_active: false,
            latency_samples: 0,
        };
    }
    return tauriInvoke('load_plugin', { pluginId, instanceId }) as Promise<PluginInstance>;
}
