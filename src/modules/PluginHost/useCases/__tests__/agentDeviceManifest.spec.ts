import { afterEach, describe, expect, it } from 'vitest';

import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore } from '../../stores/pluginScanStore';
import { getAgentDeviceFactoryManifest } from '../getAgentDeviceFactoryManifest';

describe('agent device factory manifest', () => {
    afterEach(() => {
        pluginScanStore.set(defaultPluginScanState);
    });

    it('keeps Arrangement descriptors separate from AudioEngine runtime facts', () => {
        const manifest = {
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: getAgentBuiltinDeviceFactoryManifest(),
        };

        expect(manifest).toMatchObject({
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: expect.arrayContaining([
                expect.objectContaining({
                    type: 'builtin-compressor',
                    vendor: 'Sourdaw',
                    parameters: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'comp-threshold',
                            type: 'continuous',
                            bounds: { minimum: -60, maximum: 0 },
                            automatable: true,
                        }),
                    ]),
                }),
            ]),
        });
        const builtinCompressor = manifest.devices.find((device) => device.type === 'builtin-compressor');
        expect(builtinCompressor).not.toHaveProperty('ports');
        expect(builtinCompressor).not.toHaveProperty('latency');
    });

    it('keeps external factory reads scan-only when parameter descriptors are absent', () => {
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                {
                    id: 'scan-id',
                    clap_id: 'org.example.effect',
                    name: 'Example Effect',
                    vendor: 'Example',
                    format: 'clap',
                    category: 'effect',
                    path: '/plugins/example.clap',
                    version: '1.0.0',
                    num_inputs: 2,
                    num_outputs: 2,
                    num_parameters: 4,
                    has_custom_ui: true,
                },
            ],
        });

        const manifest = getAgentDeviceFactoryManifest(['clap:org.example.effect']);

        expect(manifest).not.toBeInstanceOf(Promise);
        expect(manifest.devices).toEqual([
            expect.objectContaining({
                type: 'clap:org.example.effect',
                version: expect.stringMatching(/^external-factory-v1:[0-9a-f]{8}$/),
                versions: expect.objectContaining({
                    factory: expect.stringMatching(/^external-factory-v1:[0-9a-f]{8}$/),
                    scanner: '1.0.0',
                }),
                configuration: expect.objectContaining({ availability: 'unavailable' }),
                parameterDescriptors: {
                    availability: 'unavailable',
                    source: 'plugin-scan.parameter-descriptors-v1',
                    reason: 'The CLAP scan exposes only a factory descriptor. Parameter descriptors are instance-scoped and unavailable without instantiation.',
                },
                parameters: [],
                opaqueState: true,
            }),
        ]);
        expect(JSON.stringify(manifest)).not.toContain('/plugins/example.clap');
    });

    it('projects only scanner-declared CLAP parameter facts without inferring units, steps, or choices', () => {
        const scannedPlugin: ScannedPlugin & {
            parameters: Array<{
                id: number;
                name: string;
                min_value: number;
                max_value: number;
                default_value: number;
                is_automatable: boolean;
                is_modulatable: boolean;
                is_stepped: boolean;
                is_enum: boolean;
            }>;
        } = {
            id: 'scan-id',
            clap_id: 'org.example.effect',
            name: 'Example Effect',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/plugins/example.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 1,
            has_custom_ui: true,
            parameters: [
                {
                    id: 7,
                    name: 'Gain',
                    min_value: -12,
                    max_value: 12,
                    default_value: 0,
                    is_automatable: true,
                    is_modulatable: true,
                    is_stepped: true,
                    is_enum: false,
                },
            ],
        };
        pluginScanStore.set({ ...defaultPluginScanState, scannedPlugins: [scannedPlugin] });

        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toEqual([
            expect.objectContaining({
                configuration: { availability: 'available', source: 'plugin-scan' },
                parameterDescriptors: {
                    availability: 'available',
                    source: 'plugin-scan.parameter-descriptors-v1',
                },
                parameters: [
                    {
                        id: 'clap-param:7',
                        name: 'Gain',
                        type: {
                            availability: 'unavailable',
                            reason: 'CLAP parameter metadata does not declare a value type.',
                        },
                        unit: {
                            availability: 'unavailable',
                            reason: 'CLAP parameter metadata does not declare a unit.',
                        },
                        bounds: { minimum: -12, maximum: 12 },
                        default: 0,
                        step: {
                            availability: 'unavailable',
                            reason: 'CLAP parameter metadata does not declare a step size.',
                        },
                        choices: {
                            availability: 'unavailable',
                            reason: 'CLAP parameter metadata does not declare discrete choices.',
                        },
                        automatable: true,
                        modulatable: true,
                        flags: { stepped: true, enum: false },
                        metadata: { source: 'plugin-scan', confidence: 'declared' },
                    },
                ],
            }),
        ]);
    });

    it('fails closed for malformed scanner parameter metadata', () => {
        const scannedPlugin: ScannedPlugin & {
            parameters: Array<{
                id: number;
                name: string;
                min_value: number;
                max_value: number;
                default_value: number;
                is_automatable: boolean;
                is_modulatable: boolean;
                is_stepped: boolean;
                is_enum: boolean;
            }>;
        } = {
            id: 'scan-id',
            clap_id: 'org.example.effect',
            name: 'Example Effect',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/plugins/example.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 1,
            has_custom_ui: true,
            parameters: [
                {
                    id: 7,
                    name: 'x'.repeat(129),
                    min_value: -12,
                    max_value: 12,
                    default_value: 0,
                    is_automatable: true,
                    is_modulatable: true,
                    is_stepped: false,
                    is_enum: false,
                },
            ],
        };
        pluginScanStore.set({ ...defaultPluginScanState, scannedPlugins: [scannedPlugin] });

        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toEqual([
            expect.objectContaining({
                parameters: [],
                parameterDescriptors: expect.objectContaining({ availability: 'unavailable' }),
                configuration: expect.objectContaining({ availability: 'unavailable' }),
            }),
        ]);
    });

    it.each([
        ['a null parameter', null],
        ['a primitive parameter', 'not-a-parameter'],
        ['an object missing a name', {}],
        ['an object with a null name', { name: null }],
        ['an object with a non-string name', { name: 7 }],
    ])('fails closed without throwing for %s', (_label, malformedParameter) => {
        const scannedPlugin = {
            id: 'scan-id',
            clap_id: 'org.example.effect',
            name: 'Example Effect',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/plugins/example.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 1,
            has_custom_ui: true,
            parameters: [malformedParameter],
        } as unknown as ScannedPlugin;
        pluginScanStore.set({ ...defaultPluginScanState, scannedPlugins: [scannedPlugin] });

        expect(() => getAgentDeviceFactoryManifest(['clap:org.example.effect'])).not.toThrow();
        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toEqual([
            expect.objectContaining({
                parameters: [],
                parameterDescriptors: expect.objectContaining({ availability: 'unavailable' }),
                configuration: expect.objectContaining({ availability: 'unavailable' }),
            }),
        ]);
    });

    it('deduplicates equivalent parameter contracts and conflicts when one contract changes', () => {
        const base: ScannedPlugin = {
            id: 'scan-a',
            clap_id: 'org.example.effect',
            name: 'Example Effect',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/plugins/a.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 1,
            has_custom_ui: true,
            parameters: [
                {
                    id: 7,
                    name: 'Gain',
                    min_value: -12,
                    max_value: 12,
                    default_value: 0,
                    is_automatable: true,
                    is_modulatable: true,
                    is_stepped: false,
                    is_enum: false,
                },
            ],
        };
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [base, { ...base, id: 'scan-b', path: '/plugins/b.clap' }],
        });
        const equivalent = getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices;
        expect(equivalent).toHaveLength(1);
        const equivalentVersion = equivalent[0]?.version;

        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                base,
                {
                    ...base,
                    id: 'scan-c',
                    path: '/plugins/c.clap',
                    parameters: [{ ...base.parameters![0]!, default_value: 3 }],
                },
            ],
        });
        const conflicting = getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices;
        expect(conflicting).toEqual([
            expect.objectContaining({
                configuration: expect.objectContaining({
                    availability: 'unavailable',
                    reason: expect.stringContaining('Conflicting'),
                }),
            }),
        ]);
        expect(conflicting[0]?.version).not.toBe(equivalentVersion);
    });

    it('bounds scan metadata and never forwards raw filesystem paths', () => {
        const longVendor = 'v'.repeat(160);
        const longName = 'n'.repeat(160);
        const longCategory = 'c'.repeat(160);
        const longVersion = 'r'.repeat(160);
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                {
                    id: 'scan-id',
                    clap_id: 'org.example.effect',
                    name: `\u0000 ${longName}`,
                    vendor: `\u0000 ${longVendor}`,
                    format: 'clap',
                    category: `\u0000 ${longCategory}`,
                    path: '/private/plugins/example.clap',
                    version: `\u0000 ${longVersion}`,
                    num_inputs: 2,
                    num_outputs: 2,
                    num_parameters: Number.MAX_SAFE_INTEGER,
                    has_custom_ui: true,
                },
            ],
        });

        const manifest = getAgentDeviceFactoryManifest(['clap:org.example.effect']);

        expect(manifest.devices).toEqual([
            expect.objectContaining({
                vendor: longVendor.slice(0, 128),
                name: longName.slice(0, 128),
                category: longCategory.slice(0, 128),
                parameterCount: null,
                versions: expect.objectContaining({ scanner: longVersion.slice(0, 128) }),
            }),
        ]);
        expect(JSON.stringify(manifest)).not.toContain('\u0000');
        expect(JSON.stringify(manifest)).not.toContain('/private/plugins/example.clap');
    });

    it('derives stable factory versions from scan metadata, deduplicates equivalent rescans, and marks conflicts', () => {
        const base = {
            id: 'path-a',
            clap_id: 'org.example.effect',
            name: 'Example Effect',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/a/example.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 4,
            has_custom_ui: true,
        };
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [base, { ...base, id: 'path-b', path: '/b/example.clap' }],
        });
        const equivalent = getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices;
        expect(equivalent).toHaveLength(1);
        const equivalentVersion = equivalent[0]?.version;

        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [{ ...base, num_parameters: 5 }],
        });
        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices[0]?.version).not.toBe(
            equivalentVersion
        );

        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [base, { ...base, id: 'path-c', vendor: 'Other' }],
        });
        const conflicting = getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices;
        expect(conflicting).toEqual([
            expect.objectContaining({
                configuration: expect.objectContaining({
                    availability: 'unavailable',
                    reason: expect.stringContaining('Conflicting'),
                }),
            }),
        ]);
        expect(conflicting[0]?.version).not.toBe(equivalentVersion);
        expect(JSON.stringify(conflicting)).not.toContain('/a/example.clap');
        expect(JSON.stringify(conflicting)).not.toContain('/b/example.clap');
    });

    it('does not expand an explicitly selected external factory set', () => {
        const first = {
            id: 'first',
            clap_id: 'org.example.first',
            name: 'First',
            vendor: 'Example',
            format: 'clap',
            category: 'effect',
            path: '/plugins/first.clap',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 1,
            has_custom_ui: false,
        };
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                first,
                { ...first, id: 'second', clap_id: 'org.example.second', path: '/plugins/second.clap' },
            ],
        });

        expect(getAgentDeviceFactoryManifest(['clap:org.example.first']).devices).toEqual([
            expect.objectContaining({ type: 'clap:org.example.first' }),
        ]);
    });
});
