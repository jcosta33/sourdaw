import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDevice } from '../buildDevice';

const injectedWithheldDeviceTypes = vi.hoisted(() => new Set<string>());

vi.mock('#/infra/release/deviceReleaseAdmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/release/deviceReleaseAdmission')>();

    return {
        ...actual,
        isDeviceReleaseAdmitted: (type: string) =>
            !injectedWithheldDeviceTypes.has(type) && actual.isDeviceReleaseAdmitted(type),
    };
});

describe('buildDevice', () => {
    beforeEach(() => {
        injectedWithheldDeviceTypes.clear();
    });

    it('builds a device from a full spec with name and params', () => {
        const device = buildDevice({ type: 'builtin-eq', name: 'My EQ', params: { gain: 1.5 } });
        expect(device.type).toBe('builtin-eq');
        expect(device.name).toBe('My EQ');
        expect(device.bypassed).toBe(false);
        expect(device.parameterValues).toEqual({ gain: 1.5 });
        expect(device.id).toMatch(/^dev-/);
    });

    it('defaults name to the type when name is omitted', () => {
        const device = buildDevice({ type: 'builtin-reverb' });
        expect(device.name).toBe('builtin-reverb');
    });

    it('defaults params to an empty object when omitted', () => {
        const device = buildDevice({ type: 'faust-delay' });
        expect(device.parameterValues).toEqual({});
    });

    it('generates unique ids for each device', () => {
        const a = buildDevice({ type: 'x' });
        const b = buildDevice({ type: 'x' });
        expect(a.id).not.toBe(b.id);
    });

    it('builds Grand Boule project-template devices', () => {
        expect(buildDevice({ type: 'grand-boule' })).toMatchObject({
            type: 'grand-boule',
            name: 'grand-boule',
            parameterValues: {},
        });
    });

    it('rejects devices withheld from release templates', () => {
        injectedWithheldDeviceTypes.add('test-withheld-device');

        expect(() => buildDevice({ type: 'test-withheld-device' })).toThrow(
            'Device type "test-withheld-device" is withheld from release templates.'
        );
    });
});
