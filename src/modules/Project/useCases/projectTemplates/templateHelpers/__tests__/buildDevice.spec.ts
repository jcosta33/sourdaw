import { describe, expect, it } from 'vitest';

import { buildDevice } from '../buildDevice';

describe('buildDevice', () => {
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

    it('rejects devices withheld from release templates', () => {
        expect(() => buildDevice({ type: 'grand-boule' })).toThrow(
            'Device type "grand-boule" is withheld from release templates.'
        );
    });
});
