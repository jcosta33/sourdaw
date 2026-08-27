import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginInstance } from './types';

/**
 * Instantiate a native plugin instance.
 *
 * `sampleRate` is the rate of the engine whose audio this plugin will be fed —
 * the host activates it at that rate and converts its latency against it. The
 * host refuses a rate that is not a positive number rather than substituting
 * one, so the caller is told when it has none to give.
 */
export async function loadPlugin(pluginId: string, instanceId: string, sampleRate: number): Promise<PluginInstance> {
    if (!isDesktopRuntime()) {
        return {
            instance_id: instanceId,
            plugin_id: pluginId,
            name: 'Unavailable',
            parameters: [],
            is_active: false,
            latency_samples: 0,
            latency_ms: 0,
            bridge_round_trip_frames: 0,
            engine_plugin_id: null,
        };
    }
    return desktopInvoke('load_plugin', { pluginId, instanceId, sampleRate }) as Promise<PluginInstance>;
}
