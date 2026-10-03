import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../models/DeviceParameter';
import { isReverbDeviceType } from '../isReverbDeviceType';

describe('isReverbDeviceType', () => {
    it.each([
        'builtin-reverb',
        'builtin-convolution-reverb',
        'dutch-oven',
        'faust-zita-rev1-reverb',
        'faust-spring-reverb',
    ])('names %s, which its descriptor declares a reverb', (deviceType) => {
        expect(isReverbDeviceType(deviceType)).toBe(true);
    });

    it.each(['builtin-delay', 'faust-tape-delay', 'builtin-eq', 'crust'])(
        'does not name %s, which sounds like a tail or a space without being a reverb',
        (deviceType) => {
            expect(isReverbDeviceType(deviceType)).toBe(false);
        }
    );

    it('names the stored type older projects carry for a reverb no descriptor declares', () => {
        expect(getPluginById('proof-chamber')).toBeUndefined();
        expect(isReverbDeviceType('proof-chamber')).toBe(true);
    });

    it('does not name a device type nothing declares', () => {
        expect(isReverbDeviceType('not-a-device')).toBe(false);
    });

    it('follows the descriptor declaration rather than a list of ids', () => {
        const descriptor = getPluginById('builtin-delay');
        if (!descriptor) {
            throw new Error('Expected the delay descriptor');
        }
        const originalFamily = descriptor.effectFamily;

        try {
            descriptor.effectFamily = 'reverb';

            expect(isReverbDeviceType('builtin-delay')).toBe(true);
        } finally {
            descriptor.effectFamily = originalFamily;
        }
    });
});
