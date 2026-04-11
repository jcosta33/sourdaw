import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDeviceToStrip } from './deviceControls/addDeviceToStrip';
import { audioEngine } from '../repositories/createWebAudioEngine';

describe('addDeviceToStrip', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('forwards add-device requests to the engine', () => {
        const addDeviceSpy = vi.spyOn(audioEngine, 'addDeviceToStrip').mockImplementation(() => {});

        addDeviceToStrip('track', 'dev', 'device-type', 'external-instance');

        expect(addDeviceSpy).toHaveBeenCalledWith('track', 'dev', 'device-type', 'external-instance');
    });
});
