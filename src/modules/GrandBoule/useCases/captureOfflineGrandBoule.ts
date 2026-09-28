import { type TemperamentIndex, readGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { type GrandBoulePresetParameters } from '../models/GrandBoulePreset';
import { type GrandBouleState, peekGrandBouleStore } from '../stores/grandBouleStore';

import { projectGrandBouleCalibrationToNativePatch } from './projectGrandBouleCalibrationToNativePatch';

type CaptureOfflineGrandBouleInput = {
    deviceId: string;
    deviceState: unknown;
    /** Omit to capture the device's calibration; null preserves an absent calibration. */
    calibration?: ReturnType<typeof projectGrandBouleCalibrationToNativePatch>;
};

/**
 * The per-device store's temperament and preset voicing, or `null` when no
 * store exists — the same "nothing to project" answer the calibration gives.
 * Read through `peekGrandBouleStore` so a capture never brings a store into
 * existence, for the reason `projectGrandBouleCalibrationToNativePatch` states.
 */
type CapturedOfflineGrandBouleVoicing = {
    temperament: TemperamentIndex;
    parameters: GrandBoulePresetParameters;
} | null;

function captureVoicing(state: GrandBouleState | null | undefined): CapturedOfflineGrandBouleVoicing {
    if (state === null || state === undefined) {
        return null;
    }
    return { temperament: state.temperament, parameters: state.parameters };
}

/** Capture independent project morph and owner calibration before offline setup yields. */
export function captureOfflineGrandBoule({ deviceId, deviceState, calibration }: CaptureOfflineGrandBouleInput) {
    return structuredClone({
        morph: readGrandBouleDeviceState(deviceState).morph,
        calibration: calibration === undefined ? projectGrandBouleCalibrationToNativePatch({ deviceId }) : calibration,
        voicing: captureVoicing(peekGrandBouleStore(deviceId)?.value),
    });
}
