import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginInstance } from './types';

/**
 * Instantiate a native plugin instance.
 *
 * The native engine activates it at its own negotiated rate and converts its
 * latency against that — never a rate this call supplies. Sends no rate.
 */
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
            tail_samples: 0,
            engine_plugin_id: null,
        };
    }
    return desktopInvoke('load_plugin', { pluginId, instanceId }) as Promise<PluginInstance>;
}
