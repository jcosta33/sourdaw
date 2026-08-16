import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getAgentBuiltinDeviceFactoryManifest } from '../getAgentBuiltinDeviceFactoryManifest';

describe('built-in factory manifest law', () => {
    it('publishes owner-declared topology, latency, and complete parameter evidence for every descriptor', () => {
        const manifest = getAgentBuiltinDeviceFactoryManifest();
        expect(manifest).toHaveLength(BUILTIN_PLUGINS.length);
        for (const device of manifest) {
            expect(device.ports).toEqual(
                expect.objectContaining({
                    inputs: expect.any(Array),
                    outputs: expect.any(Array),
                    sidechain: expect.any(Array),
                })
            );
            expect(device.latency).toEqual(expect.objectContaining({ source: expect.any(String) }));
            expect(device.presets).not.toEqual([]);
            for (const parameter of device.parameters) {
                expect(parameter.semanticRole).toEqual(expect.objectContaining({ source: expect.any(String) }));
                expect(parameter.gainCompensation).toEqual(expect.objectContaining({ source: expect.any(String) }));
            }
        }
    });
});
