import { describe, it, expect, vi } from 'vitest';

import { isDeviceSupportedOnCurrentPlatform } from '../isDeviceSupportedOnCurrentPlatform';

const mocks = vi.hoisted(() => ({
    isDeviceSupportedOnCurrentPlatform: vi.fn(),
}));

vi.mock('../../models/DeviceParameter', () => ({
    isDeviceSupportedOnCurrentPlatform: mocks.isDeviceSupportedOnCurrentPlatform,
}));

describe('isDeviceSupportedOnCurrentPlatform', () => {
    it('should forward the device type to the model and return its result', () => {
        mocks.isDeviceSupportedOnCurrentPlatform.mockReturnValue(true);

        expect(isDeviceSupportedOnCurrentPlatform('fermenter')).toBe(true);
        expect(mocks.isDeviceSupportedOnCurrentPlatform).toHaveBeenCalledWith('fermenter');
    });

    it('should return false when the model reports unsupported', () => {
        mocks.isDeviceSupportedOnCurrentPlatform.mockReturnValue(false);

        expect(isDeviceSupportedOnCurrentPlatform('unknown-device')).toBe(false);
    });
});
