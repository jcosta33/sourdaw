import { afterEach, describe, expect, it } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../stores/pluginScanStore';
import { getAgentDeviceFactoryManifest } from '../getAgentDeviceFactoryManifest';

describe('agent device factory manifest', () => {
    afterEach(() => {
        pluginScanStore.set(defaultPluginScanState);
    });

    it('marks owner-undeclared topology and latency unavailable while retaining bounded inferred guidance', () => {
        const manifest = getAgentDeviceFactoryManifest();

        expect(manifest).toMatchObject({
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: expect.arrayContaining([
                expect.objectContaining({
                    type: 'builtin-compressor',
                    vendor: 'Sourdaw',
                    ports: expect.objectContaining({ availability: 'unavailable' }),
                    latency: expect.objectContaining({ availability: 'unavailable' }),
                    safetyNotes: expect.arrayContaining([expect.any(String)]),
                    usageRecipes: expect.arrayContaining([expect.any(String)]),
                    parameters: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'comp-threshold',
                            type: 'continuous',
                            bounds: { minimum: -60, maximum: 0 },
                            automatable: true,
                            modulatable: expect.objectContaining({ availability: 'unavailable' }),
                            semanticRole: expect.objectContaining({ confidence: 'inferred' }),
                            perceptualRole: expect.objectContaining({ confidence: 'inferred' }),
                            interactions: expect.arrayContaining([expect.any(String)]),
                            risks: expect.arrayContaining([expect.any(String)]),
                        }),
                    ]),
                }),
            ]),
        });
    });

    it('prevents external configuration when the scan did not publish real parameter descriptors', () => {
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

        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toEqual([
            expect.objectContaining({
                type: 'clap:org.example.effect',
                configuration: expect.objectContaining({ availability: 'unavailable' }),
                parameters: [],
                opaqueState: true,
            }),
        ]);
    });

    it('collapses equivalent rescans by CLAP identity and marks conflicting records ambiguous', () => {
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
        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toHaveLength(1);

        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [base, { ...base, id: 'path-c', vendor: 'Other' }],
        });
        expect(getAgentDeviceFactoryManifest(['clap:org.example.effect']).devices).toEqual([
            expect.objectContaining({
                configuration: expect.objectContaining({
                    availability: 'unavailable',
                            reason: expect.stringContaining('Conflicting'),
                }),
            }),
        ]);
    });
});
