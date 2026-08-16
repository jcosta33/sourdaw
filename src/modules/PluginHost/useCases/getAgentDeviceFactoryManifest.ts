import { defaultPluginScanState, pluginScanStore } from '../stores/pluginScanStore';
import { type ScannedPluginParameter } from '../models/ScannedPlugin';

const EXTERNAL_FACTORY_VERSION_PREFIX = 'external-factory-v1';
const MAX_PUBLIC_SCAN_TEXT_LENGTH = 128;
const MAX_SCANNED_PARAMETER_COUNT = 4096;
const MAX_SCANNED_PARAMETER_DESCRIPTORS = 256;
const MAX_SCANNED_PARAMETER_NAME_LENGTH = 128;
const PARAMETER_DESCRIPTOR_SOURCE = 'plugin-scan.parameter-descriptors-v1';
const PARAMETER_DESCRIPTOR_UNAVAILABLE_REASON =
    'The CLAP scan exposes only a factory descriptor. Parameter descriptors are instance-scoped and unavailable without instantiation.';
const PARAMETER_SCAN_FAILED_REASON = 'The scanner could not safely complete external parameter inspection.';

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
    parameters?: ScannedPluginParameter[];
    parameter_metadata_reason?: string;
};

type PublicScannedFactory = {
    scannerVersion: string;
    vendor: string;
    name: string;
    category: string;
    parameterCount: number | null;
};

type PublicParameter = {
    id: string;
    name: string;
    type: { availability: 'unavailable'; reason: string };
    unit: { availability: 'unavailable'; reason: string };
    bounds: { minimum: number; maximum: number };
    default: number;
    step: { availability: 'unavailable'; reason: string };
    choices: { availability: 'unavailable'; reason: string };
    automatable: boolean;
    modulatable: boolean;
    flags: { stepped: boolean; enum: boolean };
    metadata: { source: 'plugin-scan'; confidence: 'declared' };
};

type ParameterContract =
    | { availability: 'available'; parameters: PublicParameter[]; fingerprint: string }
    | { availability: 'unavailable'; reason: string; fingerprint: string };

function normalizedScanText(value: string): string {
    return Array.from(value.normalize('NFC'))
        .filter((character) => {
            const codePoint = character.codePointAt(0)!;
            return codePoint > 0x1f && codePoint !== 0x7f;
        })
        .join('')
        .trim();
}

function boundedText(value: string, fallback: string): string {
    const normalized = normalizedScanText(value);
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

function unavailableParameterContract(reason: string): ParameterContract {
    return {
        availability: 'unavailable',
        reason,
        fingerprint: stableFingerprint(['unavailable', reason]),
    };
}

function parameterContract(plugin: ScannedFactory): ParameterContract {
    if (!Array.isArray(plugin.parameters)) {
        return unavailableParameterContract(
            plugin.parameter_metadata_reason === undefined
                ? PARAMETER_DESCRIPTOR_UNAVAILABLE_REASON
                : PARAMETER_SCAN_FAILED_REASON
        );
    }
    if (
        plugin.parameters.length > MAX_SCANNED_PARAMETER_DESCRIPTORS ||
        boundedParameterCount(plugin.num_parameters) !== plugin.parameters.length
    ) {
        return unavailableParameterContract(PARAMETER_SCAN_FAILED_REASON);
    }
    const ids = new Set<number>();
    const parameters: PublicParameter[] = [];
    for (const parameter of plugin.parameters) {
        const name = parameter.name.normalize('NFC');
        if (
            !Number.isSafeInteger(parameter.id) ||
            parameter.id < 0 ||
            parameter.id >= 0xffffffff ||
            ids.has(parameter.id) ||
            name.length === 0 ||
            Array.from(name).length > MAX_SCANNED_PARAMETER_NAME_LENGTH ||
            Array.from(name).some((character) => {
                const codePoint = character.codePointAt(0)!;
                return codePoint <= 0x1f || codePoint === 0x7f;
            }) ||
            !Number.isFinite(parameter.min_value) ||
            !Number.isFinite(parameter.default_value) ||
            !Number.isFinite(parameter.max_value) ||
            parameter.min_value > parameter.default_value ||
            parameter.default_value > parameter.max_value ||
            typeof parameter.is_automatable !== 'boolean' ||
            typeof parameter.is_modulatable !== 'boolean' ||
            typeof parameter.is_stepped !== 'boolean' ||
            typeof parameter.is_enum !== 'boolean'
        ) {
            return unavailableParameterContract(PARAMETER_SCAN_FAILED_REASON);
        }
        ids.add(parameter.id);
        parameters.push({
            id: `clap-param:${parameter.id}`,
            name,
            type: {
                availability: 'unavailable',
                reason: 'CLAP parameter metadata does not declare a value type.',
            },
            unit: {
                availability: 'unavailable',
                reason: 'CLAP parameter metadata does not declare a unit.',
            },
            bounds: { minimum: parameter.min_value, maximum: parameter.max_value },
            default: parameter.default_value,
            step: {
                availability: 'unavailable',
                reason: 'CLAP parameter metadata does not declare a step size.',
            },
            choices: {
                availability: 'unavailable',
                reason: 'CLAP parameter metadata does not declare discrete choices.',
            },
            automatable: parameter.is_automatable,
            modulatable: parameter.is_modulatable,
            flags: { stepped: parameter.is_stepped, enum: parameter.is_enum },
            metadata: { source: 'plugin-scan', confidence: 'declared' },
        });
    }
    parameters.sort((left, right) => left.id.localeCompare(right.id));
    return {
        availability: 'available',
        parameters,
        fingerprint: stableFingerprint(
            parameters.flatMap((parameter) => [
                parameter.id,
                parameter.name,
                String(parameter.bounds.minimum),
                String(parameter.bounds.maximum),
                String(parameter.default),
                String(parameter.automatable),
                String(parameter.modulatable),
                String(parameter.flags.stepped),
                String(parameter.flags.enum),
            ])
        ),
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
        parameterContract(plugin).fingerprint,
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
                const parameterMetadata = parameterContract(plugin);
                const parameterDescriptors =
                    parameterMetadata.availability === 'available'
                        ? {
                              availability: 'available' as const,
                              source: PARAMETER_DESCRIPTOR_SOURCE,
                          }
                        : {
                              availability: 'unavailable' as const,
                              source: PARAMETER_DESCRIPTOR_SOURCE,
                              reason: parameterMetadata.reason,
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
                    usageRecipes:
                        parameterMetadata.availability === 'available'
                            ? ['Configure only through the owning PluginHost command boundary.']
                            : ['Configuration remains unavailable until the scanner publishes parameter descriptors.'],
                    parameters: parameterMetadata.availability === 'available' ? parameterMetadata.parameters : [],
                    parameterCount:
                        parameterMetadata.availability === 'available'
                            ? parameterMetadata.parameters.length
                            : publicFactory.parameterCount,
                    parameterDescriptors,
                    configuration: {
                        availability: (conflict || parameterMetadata.availability === 'unavailable'
                            ? 'unavailable'
                            : 'available') as 'available' | 'unavailable',
                        ...(conflict || parameterMetadata.availability === 'unavailable'
                            ? {
                                  reason: conflict
                                      ? 'Conflicting scan records for one canonical factory identity.'
                                      : parameterMetadata.reason,
                              }
                            : {}),
                        source: 'plugin-scan' as const,
                    },
                    metadata: {
                        source: 'plugin-scan',
                        confidence: parameterMetadata.availability === 'available' ? 'declared' : 'inferred',
                    },
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
