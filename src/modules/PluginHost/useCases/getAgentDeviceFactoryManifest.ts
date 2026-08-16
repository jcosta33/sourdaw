import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';

/**
 * Versioned factory catalogue for agent reads. External scan data is never
 * promoted to mutable plugin state: absent fields remain explicitly inferred.
 */
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
            ports: {
                inputs: [{ id: 'main-in', channels: plugin.num_inputs }],
                outputs: [{ id: 'main-out', channels: plugin.num_outputs }],
                sidechain: [],
            },
            latency: { samples: null, confidence: 'unknown' as const },
            tail: null,
            presets: [],
            safetyNotes: ['External plugin state is opaque and is not patched by the manifest.'],
            usageRecipes: [],
            parameters: [],
            parameterCount: plugin.num_parameters,
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
