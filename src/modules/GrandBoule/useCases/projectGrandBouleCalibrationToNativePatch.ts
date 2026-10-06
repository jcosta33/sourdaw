import { GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES } from '../models/GrandBouleCalibrationDspParamNames';
import { createDefaultGrandBouleState, peekGrandBouleStore } from '../stores/grandBouleStore';

export type ProjectGrandBouleCalibrationToNativePatchInput = {
    deviceId: string;
    /**
     * Answer for a device the way a freshly loaded project would: a device
     * with no store yet gets the calibration a fresh store starts with,
     * rather than `null`.
     */
    projectOnly?: boolean;
};

function readCalibration({ deviceId, projectOnly = false }: ProjectGrandBouleCalibrationToNativePatchInput) {
    const stored = peekGrandBouleStore(deviceId)?.value?.midiCalibration;
    if (stored !== undefined || !projectOnly) {
        return stored;
    }
    return createDefaultGrandBouleState().midiCalibration;
}

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
 * default-valued store no panel ever opened. The per-device store is the
 * calibration's single source of truth for every body once it exists —
 * `reconcileGrandBouleDeviceStateFromProject.ts` hydrates one for every
 * Grand Boule device on load, so a store "never given a calibration" still
 * holds real values (the same defaults `createDefaultMidiCalibration`
 * gives every fresh store) and this projects them like any other. `null`
 * answers only the one case where no store exists at all — the same
 * "nothing to project" answer Toaster and Levain give for a state-free
 * chunk — unless the caller renders a supplied document (`projectOnly`),
 * where a device no store backs yet is one that load has not reached.
 */
export function projectGrandBouleCalibrationToNativePatch(
    input: ProjectGrandBouleCalibrationToNativePatchInput
): Readonly<Record<string, number>> | null {
    const calibration = readCalibration(input);
    if (calibration === undefined) {
        return null;
    }
    return {
        [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.sustainThreshold]: calibration.sustainThreshold,
        [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.ccSmoothingMs]: calibration.ccSmoothingMs,
    };
}
