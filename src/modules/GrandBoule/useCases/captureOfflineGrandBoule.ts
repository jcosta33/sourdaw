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
    /**
     * Restore what a freshly loaded `deviceState` restores: its own voicing,
     * never a live store's, and — when `calibration` is omitted — the live
     * store's calibration, which is never project state, or a fresh store's.
     * A supplied document's device may share its id with a live device it has
     * rewritten, so the live store describes a different chunk.
     */
    projectOnly?: boolean;
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

function captureCalibration({ deviceId, calibration, projectOnly = false }: CaptureOfflineGrandBouleInput) {
    if (calibration !== undefined) {
        return calibration;
    }
    return projectGrandBouleCalibrationToNativePatch({ deviceId, projectOnly });
}

/** Capture independent project morph, voicing and owner calibration before offline setup yields. */
export function captureOfflineGrandBoule(input: CaptureOfflineGrandBouleInput) {
    const persisted = readGrandBouleDeviceState(input.deviceState);
    const liveState = input.projectOnly === true ? null : peekGrandBouleStore(input.deviceId)?.value;
    return structuredClone({
        morph: persisted.morph,
        calibration: captureCalibration(input),
        voicing: captureVoicing(liveState, persisted),
    });
}
