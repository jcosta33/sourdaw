import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';

const EXTERNAL_FACTORY_VERSION_PREFIX = 'external-factory-v1';
const MAX_PUBLIC_SCAN_TEXT_LENGTH = 128;
const MAX_SCANNED_PARAMETER_COUNT = 4096;
const PARAMETER_DESCRIPTOR_SOURCE = 'plugin-scan.parameter-descriptors-v1';
const PARAMETER_DESCRIPTOR_UNAVAILABLE_REASON =
    'The CLAP scan exposes only a factory descriptor. Parameter descriptors are instance-scoped and unavailable without instantiation.';

type ScannedFactory = {
    clap_id: string;
    id: string;
    version: string;
    vendor: string;
    name: string;
    category: string;
    num_inputs: number;
    num_outputs: number;
    num_parameters: number;
};

type PublicScannedFactory = {
    scannerVersion: string;
    vendor: string;
    name: string;
    category: string;
    parameterCount: number | null;
};

function boundedText(value: string, fallback: string): string {
    const normalized = Array.from(value.normalize('NFC'))
        .filter((character) => {
            const codePoint = character.codePointAt(0)!;
            return codePoint > 0x1f && codePoint !== 0x7f;
        })
        .join('')
        .trim();
    if (normalized.length === 0) {
        return fallback;
    }
    return Array.from(normalized).slice(0, MAX_PUBLIC_SCAN_TEXT_LENGTH).join('');
}

function stableFingerprint(parts: readonly string[]): string {
    let hash = 0x811c9dc5;
    for (const part of parts) {
        for (let index = 0; index < part.length; index += 1) {
            hash ^= part.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        hash ^= part.length;
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function factoryType(plugin: Pick<ScannedFactory, 'clap_id' | 'id'>): string {
    const clapId = boundedText(plugin.clap_id, '');
    if (clapId.length > 0 && plugin.clap_id.length <= 240) {
        return `clap:${clapId}`;
    }
    return `clap-scan:${stableFingerprint([plugin.clap_id, plugin.id])}`;
}

function boundedParameterCount(value: number): number | null {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SCANNED_PARAMETER_COUNT ? value : null;
}

function publicScannedFactory(plugin: ScannedFactory): PublicScannedFactory {
    return {
        scannerVersion: boundedText(plugin.version, 'unavailable'),
        vendor: boundedText(plugin.vendor, 'unavailable'),
        name: boundedText(plugin.name, 'unavailable'),
        category: boundedText(plugin.category, 'unavailable'),
        parameterCount: boundedParameterCount(plugin.num_parameters),
    };
}

function advertisedFactoryFingerprint(plugin: ScannedFactory): string {
    return stableFingerprint([
        factoryType(plugin),
        plugin.clap_id || plugin.id,
        plugin.version,
        plugin.vendor,
        plugin.name,
        plugin.category,
        String(plugin.num_inputs),
        String(plugin.num_outputs),
        String(plugin.num_parameters),
        PARAMETER_DESCRIPTOR_SOURCE,
    ]);
}

function factoryVersion(fingerprints: readonly string[]): string {
    return `${EXTERNAL_FACTORY_VERSION_PREFIX}:${stableFingerprint([...fingerprints].sort())}`;
}

/**
 * Scan factories are not loaded PluginHost instances and are never queried as such.
 * CLAP does not publish parameter descriptors on its factory descriptor, so the
 * manifest names the scanner-owned extension that would be required instead of
 * creating an instance to inspect CLAP_EXT_PARAMS.
 */
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
                const fingerprints = [...new Set(candidates.map(advertisedFactoryFingerprint))].sort();
                const conflict = fingerprints.length > 1;
                const plugin = [...candidates].sort((left, right) =>
                    advertisedFactoryFingerprint(left).localeCompare(advertisedFactoryFingerprint(right))
                )[0]!;
                const publicFactory = publicScannedFactory(plugin);
                const version = factoryVersion(fingerprints);
                const parameterDescriptors = {
                    availability: 'unavailable' as const,
                    source: PARAMETER_DESCRIPTOR_SOURCE,
                    reason: PARAMETER_DESCRIPTOR_UNAVAILABLE_REASON,
                };
                return {
                    type,
                    version,
                    versions: {
                        factory: version,
                        scanner: publicFactory.scannerVersion,
                    },
                    vendor: publicFactory.vendor,
                    name: publicFactory.name,
                    category: publicFactory.category,
                    capabilities: ['external-plugin'],
                    ports: { availability: 'unavailable' as const, source: 'plugin-scan' as const },
                    latency: { availability: 'unavailable' as const, source: 'plugin-scan' as const },
                    tail: null,
                    presets: { availability: 'unavailable' as const },
                    safetyNotes: ['External plugin state is opaque and is not patched by the manifest.'],
                    usageRecipes: [
                        'Configuration remains unavailable until the scanner publishes parameter descriptors.',
                    ],
                    parameters: [],
                    parameterCount: publicFactory.parameterCount,
                    parameterDescriptors,
                    configuration: {
                        availability: 'unavailable' as const,
                        reason: conflict
                            ? 'Conflicting scan records for one canonical factory identity.'
                            : PARAMETER_DESCRIPTOR_UNAVAILABLE_REASON,
                        source: 'plugin-scan' as const,
                    },
                    metadata: { source: 'plugin-scan', confidence: 'inferred' as const },
                    opaqueState: true,
                };
            }),
    ];
    return {
        schema: 'sourdaw.agent-device-factory-manifest',
        schemaVersion: 1 as const,
        devices: types === undefined ? devices : devices.filter((device) => types.includes(device.type)),
    };
}
