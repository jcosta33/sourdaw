import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { addDeviceToStrip } from './deviceControls';

describe('addDeviceToStrip', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not touch the engine when the device type is unsupported', () => {
        const isDeviceSupportedOnCurrentPlatform = vi.fn().mockReturnValue(false);
        injectDependencies(addDeviceToStrip, { isDeviceSupportedOnCurrentPlatform });

        addDeviceToStrip('track', 'dev', 'unsupported-type');

        expect(isDeviceSupportedOnCurrentPlatform).toHaveBeenCalledWith('unsupported-type');
    });
});
