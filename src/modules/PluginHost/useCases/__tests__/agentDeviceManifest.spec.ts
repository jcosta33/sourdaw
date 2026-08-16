import { describe, expect, it } from 'vitest';

import { getAgentDeviceFactoryManifest } from '../getAgentDeviceFactoryManifest';

describe('agent device factory manifest', () => {
    it('returns a versioned, complete built-in manifest without inventing external-plugin state', () => {
        const manifest = getAgentDeviceFactoryManifest();

        expect(manifest).toMatchObject({
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: expect.arrayContaining([
                expect.objectContaining({
                    type: 'builtin-compressor',
                    vendor: 'Sourdaw',
                    ports: expect.objectContaining({ inputs: expect.any(Array), outputs: expect.any(Array) }),
                    parameters: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'comp-threshold',
                            type: 'continuous',
                            bounds: { minimum: -60, maximum: 0 },
                            automatable: true,
                            modulatable: false,
                        }),
                    ]),
                }),
            ]),
        });
    });
});
