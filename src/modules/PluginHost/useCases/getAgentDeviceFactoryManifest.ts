import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';

/** Scan factories are not loaded PluginHost instances and are never queried as such. */
export function getAgentDeviceFactoryManifest(types?: readonly string[]) {
    const scannedPlugins = (pluginScanStore.value ?? defaultPluginScanState).scannedPlugins;
    const devices = [
        ...getAgentBuiltinDeviceFactoryManifest(),
        ...scannedPlugins.map((plugin) => ({
            type: plugin.clap_id || plugin.id,
            version: plugin.version,
            vendor: plugin.vendor,
            name: plugin.name,
            category: plugin.category,
            capabilities: ['external-plugin'],
            ports: { availability: 'unavailable' as const, source: 'plugin-scan' as const },
            latency: { availability: 'unavailable' as const, source: 'plugin-scan' as const },
            tail: null,
            presets: { availability: 'unavailable' as const },
            safetyNotes: ['External plugin state is opaque and is not patched by the manifest.'],
            usageRecipes: ['Configuration requires PluginHost factory parameter evidence.'],
            parameters: [],
            parameterCount: plugin.num_parameters,
            configuration: {
                availability: 'unavailable' as const,
                reason: 'A scan factory identity is not a loaded PluginHost instance identity.',
                source: 'plugin-scan' as const,
            },
            metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
            opaqueState: true,
        })),
    ];
    return {
        schema: 'sourdaw.agent-device-factory-manifest',
        schemaVersion: 1 as const,
        devices: types === undefined ? devices : devices.filter((device) => types.includes(device.type)),
    };
}
