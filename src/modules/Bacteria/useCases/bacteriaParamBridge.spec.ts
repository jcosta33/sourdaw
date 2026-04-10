import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    loadBacteriaPatchWithAudio,
    setBacteriaBandParamWithAudio,
    setBacteriaParamWithAudio,
} from './bacteriaParamBridge';

describe('bacteriaParamBridge', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('setBacteriaParamWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(setBacteriaParamWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        setBacteriaParamWithAudio('missing-device', 'mix', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('setBacteriaBandParamWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(setBacteriaBandParamWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        setBacteriaBandParamWithAudio('missing-device', 0, 'gain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadBacteriaPatchWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(loadBacteriaPatchWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        loadBacteriaPatchWithAudio('missing-device', { bands: [] } as never);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
