import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginInstance } from './types';

export async function loadPlugin(pluginId: string, instanceId: string): Promise<PluginInstance> {
    if (!isDesktopRuntime()) {
        return {
            instance_id: instanceId,
            plugin_id: pluginId,
            name: 'Unavailable',
            parameters: [],
            is_active: false,
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: null,
        };
    }
    return desktopInvoke('load_plugin', { pluginId, instanceId }) as Promise<PluginInstance>;
}
