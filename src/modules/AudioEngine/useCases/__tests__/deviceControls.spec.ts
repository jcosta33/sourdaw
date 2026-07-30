import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { addDeviceToStrip } from '../deviceControls/addDeviceToStrip';

describe('addDeviceToStrip', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('forwards add-device requests to the engine', () => {
        const addDeviceSpy = vi.spyOn(audioEngine, 'addDeviceToStrip').mockImplementation(() => {});

        addDeviceToStrip('track', 'dev', 'device-type', 'external-instance', ['earlier']);

        expect(addDeviceSpy).toHaveBeenCalledWith('track', 'dev', 'device-type', 'external-instance', ['earlier']);
    });
});
