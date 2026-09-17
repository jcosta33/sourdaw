import { beforeEach, describe, expect, it, vi } from 'vitest';

const morph = { modelA: 'mellow-grand', modelB: 'clear-grand', morphPosition: 0.3, layerBalance: 0, enabled: true };
const mocks = vi.hoisted(() => ({
    apply: vi.fn(),
    hydrate: vi.fn(),
    engine: { isReady: vi.fn() },
    createGrandBouleStore: vi.fn(),
    syncMidiCalibrationToEngine: vi.fn(),
}));

vi.mock('../applyGrandBouleMorphState', () => ({ applyGrandBouleMorphState: mocks.apply }));
vi.mock('../hydrateGrandBouleMorphStateFromProject', () => ({
    hydrateGrandBouleMorphStateFromProject: mocks.hydrate,
}));
vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => mocks.engine }));
vi.mock('../../stores/grandBouleStore', () => ({ createGrandBouleStore: mocks.createGrandBouleStore }));
vi.mock('../calibrateGrandBouleMidi/syncMidiCalibrationToEngine', () => ({
    syncMidiCalibrationToEngine: mocks.syncMidiCalibrationToEngine,
}));

import { reconcileGrandBouleDeviceStateFromProject } from '../reconcileGrandBouleDeviceStateFromProject';

describe('reconcileGrandBouleDeviceStateFromProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('syncs the store calibration onto a ready engine on load, alongside the morph', () => {
        const store = { value: { midiCalibration: { sustainThreshold: 0.6, ccSmoothingMs: 40 } } };
        mocks.hydrate.mockReturnValue(morph);
        mocks.engine.isReady.mockReturnValue(true);
        mocks.createGrandBouleStore.mockReturnValue(store);

        reconcileGrandBouleDeviceStateFromProject('grand-1');

        expect(mocks.hydrate).toHaveBeenCalledWith('grand-1');
        expect(mocks.apply).toHaveBeenCalledWith(mocks.engine, morph);
        expect(mocks.createGrandBouleStore).toHaveBeenCalledWith('grand-1');
        expect(mocks.syncMidiCalibrationToEngine).toHaveBeenCalledTimes(1);
        expect(mocks.syncMidiCalibrationToEngine).toHaveBeenCalledWith({ engine: mocks.engine, store });
    });

    it('syncs the untouched store defaults for a device whose panel was never opened', () => {
        const store = { value: { midiCalibration: { sustainThreshold: 0.15, ccSmoothingMs: 5 } } };
        mocks.hydrate.mockReturnValue(morph);
        mocks.engine.isReady.mockReturnValue(true);
        mocks.createGrandBouleStore.mockReturnValue(store);

        reconcileGrandBouleDeviceStateFromProject('grand-2');

        expect(mocks.syncMidiCalibrationToEngine).toHaveBeenCalledWith({ engine: mocks.engine, store });
    });

    it('does not sync calibration when the engine is not ready', () => {
        mocks.hydrate.mockReturnValue(morph);
        mocks.engine.isReady.mockReturnValue(false);

        reconcileGrandBouleDeviceStateFromProject('grand-3');

        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.syncMidiCalibrationToEngine).not.toHaveBeenCalled();
    });

    it('does not sync calibration for a device that is not a Grand Boule', () => {
        mocks.hydrate.mockReturnValue(null);

        reconcileGrandBouleDeviceStateFromProject('not-grand-boule');

        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.createGrandBouleStore).not.toHaveBeenCalled();
        expect(mocks.syncMidiCalibrationToEngine).not.toHaveBeenCalled();
    });
});
