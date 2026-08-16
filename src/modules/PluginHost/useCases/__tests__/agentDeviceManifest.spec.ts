import { afterEach, describe, expect, it } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../stores/pluginScanStore';
import { getAgentDeviceFactoryManifest } from '../getAgentDeviceFactoryManifest';

describe('agent device factory manifest', () => {
    afterEach(() => {
        pluginScanStore.set(defaultPluginScanState);
    });

    it('marks owner-undeclared topology and latency unavailable while retaining bounded inferred guidance', async () => {
        const manifest = await getAgentDeviceFactoryManifest();

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

    it('prevents external configuration when the scan did not publish real parameter descriptors', async () => {
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

        expect((await getAgentDeviceFactoryManifest(['org.example.effect'])).devices).toEqual([
            expect.objectContaining({
                type: 'org.example.effect',
                configuration: expect.objectContaining({ availability: 'unavailable' }),
                parameters: [],
                opaqueState: true,
            }),
        ]);
    });
});
