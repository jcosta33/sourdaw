/**
 * Both carriers start on the same calibration for a device that has been
 * hydrated but never opened its panel (#4310).
 *
 * `reconcileGrandBouleDeviceStateFromProject.ts` mirrors the store's
 * calibration onto a ready web engine on load; `projectGrandBouleCalibrationToNativePatch.ts`
 * folds the same store into a native body built at Play. This welds the two
 * against the same store, field by field, so neither can drift from the
 * other's naming or values without failing here.
 */

import { describe, expect, it, vi } from 'vitest';

import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore } from '../../stores/grandBouleStore';
import { syncMidiCalibrationToEngine } from '../calibrateGrandBouleMidi/syncMidiCalibrationToEngine';
import { projectGrandBouleCalibrationToNativePatch } from '../projectGrandBouleCalibrationToNativePatch';

describe('grandBouleCalibrationParity', () => {
    it('gives the web load path and the native build path the same values for a hydrated default store', () => {
        const deviceId = `parity-${Math.random()}`;
        const store = createGrandBouleStore(deviceId);
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');

        syncMidiCalibrationToEngine({ engine, store });
        const nativePatch = projectGrandBouleCalibrationToNativePatch({ deviceId });

        expect(setCalibration).toHaveBeenCalledTimes(1);
        const webCalibration = setCalibration.mock.calls[0]![0];
        // The DSP's own wire names, spelled literally rather than through
        // `GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES`: referencing the shared
        // constant on both sides would make this pass even if the constant
        // itself drifted from the DSP's vocabulary, since both the web and
        // native record would shift together.
        expect(nativePatch).toEqual({
            sustain_threshold: webCalibration.sustainThreshold,
            cc_smoothing_ms: webCalibration.ccSmoothingMs,
        });
    });
});
