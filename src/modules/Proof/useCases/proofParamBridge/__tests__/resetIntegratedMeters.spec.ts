import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bridges, type ProofAudioBridge } from '../helpers';
import { resetIntegratedMeters } from '../resetIntegratedMeters';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

describe('resetIntegratedMeters', () => {
    beforeEach(() => {
        bridges.clear();
    });

    it('forwards the reset to the registered bridge for that device', () => {
        const bridge: ProofAudioBridge = {
            reorderModules: vi.fn(),
            resetIntegrated: vi.fn(),
        };
        bridges.set('dev-1', bridge);

        resetIntegratedMeters('dev-1');

        expect(bridge.resetIntegrated).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no bridge is registered for the device', () => {
        expect(() => resetIntegratedMeters('missing-device')).not.toThrow();
    });
});
