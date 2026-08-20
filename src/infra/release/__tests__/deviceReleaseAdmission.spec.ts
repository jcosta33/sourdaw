import { describe, expect, it } from 'vitest';

import { isDeviceReleaseAdmitted } from '../deviceReleaseAdmission';

describe('device release admission', () => {
    it('withholds Grand Boule without blocking admitted or external devices', () => {
        expect(isDeviceReleaseAdmitted('grand-boule')).toBe(false);
        expect(isDeviceReleaseAdmitted('fermenter')).toBe(true);
        expect(isDeviceReleaseAdmitted('third-party-clap')).toBe(true);
    });
});
