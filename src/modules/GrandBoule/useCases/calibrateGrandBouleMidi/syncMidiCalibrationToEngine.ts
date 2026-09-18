import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

type SyncMidiCalibrationToEngineInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
};

/**
 * Push the engine-consumed half of the MIDI calibration to both bodies.
 *
 * Three of the five calibration values (`velocityCurveExponent`,
 * `velocityFloor`, `velocityCeiling`) are not engine parameters — they shape
 * velocity in TypeScript at note time. The other two are, and both shape how
 * the sustain controller reaches the damper model:
 *
 * * `sustainThreshold` is the lower edge of the half-pedal smoothstep — the
 *   pedal position at which the dampers begin to leave the strings. Its
 *   default, 0.15, is exactly the `DEFAULT_HALF_PEDAL_LOW` the DSP was
 *   hardcoded to, so a default calibration renders identically to before.
 * * `ccSmoothingMs` is the time constant applied to the continuous CC64
 *   position on its way into that curve.
 *
 * `GrandBouleEngineHandle.setCalibration` is the one door for both: the Web
 * Audio `grandBouleControls` node, and — when this device is carried natively
 * — the daw-engine `GrandBouleBody` sharing the same daw-dsp engine. Without
 * the second half a calibrated half-pedal would damp at two different
 * positions depending on which carrier is sounding.
 *
 * Every writer of those two values calls this, and so does the panel once its
 * engine reports ready: a value that only reached the store would leave the
 * readout describing a piano that is not playing.
 */
export function syncMidiCalibrationToEngine(input: SyncMidiCalibrationToEngineInput): void {
    const calibration = input.store.value?.midiCalibration;
    if (calibration === undefined) {
        return;
    }
    // The clamped, stored values rather than whatever was requested, so the
    // engine cannot drift away from what the panel displays.
    input.engine.setCalibration({
        sustainThreshold: calibration.sustainThreshold,
        ccSmoothingMs: calibration.ccSmoothingMs,
    });
}
