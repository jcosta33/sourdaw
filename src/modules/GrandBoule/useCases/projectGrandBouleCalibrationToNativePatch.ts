import { GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES } from '../models/GrandBouleCalibrationDspParamNames';
import { peekGrandBouleStore } from '../stores/grandBouleStore';

export type ProjectGrandBouleCalibrationToNativePatchInput = {
    deviceId: string;
};

/**
 * A Grand Boule device's engine-consumed MIDI calibration as the numeric
 * record its native body needs merged into `parameterValues` (#4302).
 *
 * MIDI calibration is not `deviceState` at all — it lives only in the
 * per-device store `createGrandBouleStore(deviceId)` — so unlike Toaster's
 * kit or Levain's articulation, this projection cannot decode a chunk it is
 * handed; it has to look the store up itself by `deviceId`. This is the
 * build-time half of carrying calibration to the native body: a device
 * splice (re)builds a native `GrandBouleBody` from scratch at every Play, and
 * without this it would always start on the DSP's own defaults —
 * `DEFAULT_HALF_PEDAL_LOW` and default smoothing — regardless of what the
 * panel had calibrated. `resolveGrandBouleEngine.ts` is the live half,
 * mirroring a calibration write onto a body already carried the moment it is
 * set; this half covers the body that comes up afterward.
 *
 * `peekGrandBouleStore` rather than `createGrandBouleStore`: a projection
 * asked about a device with no open panel must not bring a store into
 * existence, or building a native body would leave behind a stray
 * default-valued store no panel ever opened. No store, or a store never
 * given a calibration, both mean the DSP defaults are correct and this
 * answers `null` — the same "nothing to project" answer Toaster and Levain
 * give for a state-free chunk.
 */
export function projectGrandBouleCalibrationToNativePatch(
    input: ProjectGrandBouleCalibrationToNativePatchInput
): Readonly<Record<string, number>> | null {
    const calibration = peekGrandBouleStore(input.deviceId)?.value?.midiCalibration;
    if (calibration === undefined) {
        return null;
    }
    return {
        [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.sustainThreshold]: calibration.sustainThreshold,
        [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.ccSmoothingMs]: calibration.ccSmoothingMs,
    };
}
