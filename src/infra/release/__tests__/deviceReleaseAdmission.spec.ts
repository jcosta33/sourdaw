import { describe, expect, it } from 'vitest';

import {
    assertReleaseAdmittedDevices,
    findWithheldDeviceType,
    isDeviceReleaseAdmitted,
} from '../deviceReleaseAdmission';

describe('device release admission', () => {
    it('admits project and external devices', () => {
        expect(isDeviceReleaseAdmitted('grand-boule')).toBe(true);
        expect(isDeviceReleaseAdmitted('fermenter')).toBe(true);
        expect(isDeviceReleaseAdmitted('third-party-clap')).toBe(true);
        expect(findWithheldDeviceType([{ type: 'fermenter' }, { type: 'grand-boule' }])).toBeUndefined();
        expect(findWithheldDeviceType([{ type: 'third-party-clap' }])).toBeUndefined();
    });

    it('admits Grand Boule anywhere in a new project graph', () => {
        expect(() =>
            assertReleaseAdmittedDevices([{ devices: [{ type: 'fermenter' }] }, { devices: [{ type: 'grand-boule' }] }])
        ).not.toThrow();
        expect(() => assertReleaseAdmittedDevices([{ devices: [{ type: 'third-party-clap' }] }])).not.toThrow();
    });
});
