import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';

function factoryType(plugin: { format: string; clap_id: string; id: string }): string {
    return plugin.clap_id
        ? `${plugin.format.toLowerCase()}:${plugin.clap_id}`
        : `${plugin.format.toLowerCase()}:${plugin.id}`;
}

function sameAdvertisedFactory(
    left: {
        version: string;
        vendor: string;
        name: string;
        category: string;
        num_inputs: number;
        num_outputs: number;
        num_parameters: number;
    },
    right: {
        version: string;
        vendor: string;
        name: string;
        category: string;
        num_inputs: number;
        num_outputs: number;
        num_parameters: number;
    }
): boolean {
    return (
        left.version === right.version &&
        left.vendor === right.vendor &&
        left.name === right.name &&
        left.category === right.category &&
        left.num_inputs === right.num_inputs &&
        left.num_outputs === right.num_outputs &&
        left.num_parameters === right.num_parameters
    );
}

/** Scan factories are not loaded PluginHost instances and are never queried as such. */
export function getAgentDeviceFactoryManifest(types?: readonly string[]) {
    const scannedPlugins = (pluginScanStore.value ?? defaultPluginScanState).scannedPlugins;
    const devices = [
        ...[
            ...scannedPlugins.reduce((groups, plugin) => {
                const type = factoryType(plugin);
                groups.set(type, [...(groups.get(type) ?? []), plugin]);
                return groups;
            }, new Map<string, typeof scannedPlugins>()),
        ]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([type, candidates]) => {
                const plugin = candidates[0]!;
                const conflict = candidates.some((candidate) => !sameAdvertisedFactory(plugin, candidate));
                return {
                    type,
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
                        reason: conflict
                            ? 'Conflicting scan records for one canonical factory identity.'
                            : 'A scan factory identity is not a loaded PluginHost instance identity.',
                        source: 'plugin-scan' as const,
                    },
                    metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
                    opaqueState: true,
                    ...(conflict
                        ? {
                              candidates: candidates.slice(0, 8).map((candidate) => ({
                                  path: candidate.path,
                                  version: candidate.version,
                                  vendor: candidate.vendor,
                                  name: candidate.name,
                                  category: candidate.category,
                                  parameterCount: candidate.num_parameters,
                              })),
                          }
                        : {}),
                };
            }),
    ];
    return {
        schema: 'sourdaw.agent-device-factory-manifest',
        schemaVersion: 1 as const,
        devices: types === undefined ? devices : devices.filter((device) => types.includes(device.type)),
    };
}
