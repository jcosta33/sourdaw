import { describe, expect, it } from 'vitest';

import {
    assertReleaseAdmittedDevices,
    findWithheldDeviceType,
    isDeviceReleaseAdmitted,
} from '../deviceReleaseAdmission';

describe('device release admission', () => {
    it('withholds Grand Boule without blocking admitted or external devices', () => {
        expect(isDeviceReleaseAdmitted('grand-boule')).toBe(false);
        expect(isDeviceReleaseAdmitted('fermenter')).toBe(true);
        expect(isDeviceReleaseAdmitted('third-party-clap')).toBe(true);
        expect(findWithheldDeviceType([{ type: 'fermenter' }, { type: 'grand-boule' }])).toBe('grand-boule');
        expect(findWithheldDeviceType([{ type: 'third-party-clap' }])).toBeUndefined();
    });

    it('rejects withheld devices anywhere in a new project graph', () => {
        expect(() =>
            assertReleaseAdmittedDevices([{ devices: [{ type: 'fermenter' }] }, { devices: [{ type: 'grand-boule' }] }])
        ).toThrow('Device type "grand-boule" is withheld from release.');
        expect(() => assertReleaseAdmittedDevices([{ devices: [{ type: 'third-party-clap' }] }])).not.toThrow();
    });
});
