import { readGrandBouleMorphState } from '../models/GrandBouleDeviceState';

import { projectGrandBouleCalibrationToNativePatch } from './projectGrandBouleCalibrationToNativePatch';

type CaptureOfflineGrandBouleInput = {
    deviceId: string;
    deviceState: unknown;
    /** Omit to capture the device's calibration; null preserves an absent calibration. */
    calibration?: ReturnType<typeof projectGrandBouleCalibrationToNativePatch>;
};

/** Capture independent project morph and owner calibration before offline setup yields. */
export function captureOfflineGrandBoule({ deviceId, deviceState, calibration }: CaptureOfflineGrandBouleInput) {
    return structuredClone({
        morph: readGrandBouleMorphState(deviceState),
        calibration: calibration === undefined ? projectGrandBouleCalibrationToNativePatch({ deviceId }) : calibration,
    });
}
