import {
    type GrandBoulePersistedState,
    type TemperamentIndex,
    readGrandBouleDeviceState,
} from '../models/GrandBouleDeviceState';
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
 * The tuning and preset voicing the offline render restores: the per-device
 * store's when the device is live, otherwise the project truth the morph half
 * reads — `readGrandBouleDeviceState`'s defaults when the chunk is absent or
 * predates #4727, the same answer an engine-less reload takes. Read through
 * `peekGrandBouleStore` so a capture never brings a store into existence, for
 * the reason `projectGrandBouleCalibrationToNativePatch` states.
 */
type CapturedOfflineGrandBouleVoicing = {
    temperament: TemperamentIndex;
    parameters: GrandBoulePresetParameters;
};

/** The live store wins; without one the persisted chunk is the only carrier. */
function captureVoicing(
    state: GrandBouleState | null | undefined,
    persisted: GrandBoulePersistedState
): CapturedOfflineGrandBouleVoicing {
    const source = state ?? persisted;
    return { temperament: source.temperament, parameters: source.parameters };
}

/** Capture independent project morph, voicing and owner calibration before offline setup yields. */
export function captureOfflineGrandBoule({ deviceId, deviceState, calibration }: CaptureOfflineGrandBouleInput) {
    const persisted = readGrandBouleDeviceState(deviceState);
    return structuredClone({
        morph: persisted.morph,
        calibration: calibration === undefined ? projectGrandBouleCalibrationToNativePatch({ deviceId }) : calibration,
        voicing: captureVoicing(peekGrandBouleStore(deviceId)?.value, persisted),
    });
}
