import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { getPluginParameters } from '../repositories/pluginBridge/getPluginParameters';
import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';

/**
 * Versioned factory catalogue for agent reads. External scan data is never
 * promoted to mutable plugin state: absent fields remain explicitly inferred.
 */
export async function getAgentDeviceFactoryManifest(types?: readonly string[]) {
    const scannedPlugins = (pluginScanStore.value ?? defaultPluginScanState).scannedPlugins;
    const externalDevices = await Promise.all(
        scannedPlugins.map(async (plugin) => {
            try {
                const parameters = await getPluginParameters(plugin.id);
                const configuration =
                    parameters.length === plugin.num_parameters
                        ? { availability: 'available' as const, source: 'PluginHost parameter bridge' as const }
                        : {
                              availability: 'unavailable' as const,
                              reason: 'PluginHost parameter bridge did not return a complete descriptor set.',
                              source: 'plugin-scan' as const,
                          };
                return {
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
                    usageRecipes: ['Configure only when PluginHost publishes complete parameter evidence.'],
                    parameters:
                        configuration.availability === 'available'
                            ? parameters.map((parameter) => ({
                                  id: String(parameter.id),
                                  name: parameter.name,
                                  type: 'continuous' as const,
                                  unit: parameter.unit,
                                  bounds: { minimum: parameter.min_value, maximum: parameter.max_value },
                                  default: parameter.default_value,
                                  enumValues: null,
                                  automatable: parameter.is_automatable,
                                  metadata: { source: 'PluginHost parameter bridge', confidence: 'declared' as const },
                              }))
                            : [],
                    parameterCount: plugin.num_parameters,
                    configuration,
                    metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
                    opaqueState: true,
                };
            } catch {
                return {
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
                    usageRecipes: ['Parameter evidence is unavailable.'],
                    parameters: [],
                    parameterCount: plugin.num_parameters,
                    configuration: {
                        availability: 'unavailable' as const,
                        reason: 'PluginHost parameter bridge failed.',
                        source: 'PluginHost parameter bridge' as const,
                    },
                    metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
                    opaqueState: true,
                };
            }
        })
    );
    const devices = [
        ...getAgentBuiltinDeviceFactoryManifest(),
        ...externalDevices,
        /*
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
            configuration: {
                availability: 'unavailable' as const,
                reason: 'Plugin scan published only an aggregate parameter count; no stable parameter descriptors are available.',
                source: 'plugin-scan' as const,
            },
            metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
            opaqueState: true,
        */
    ];
    return {
        schema: 'sourdaw.agent-device-factory-manifest',
        schemaVersion: 1 as const,
        devices: types === undefined ? devices : devices.filter((device) => types.includes(device.type)),
    };
}
