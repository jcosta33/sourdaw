import { readGrandBouleMorphState } from '../models/GrandBouleDeviceState';
import { projectGrandBouleMorphState } from '../models/ProjectGrandBouleMorphState';

import { projectGrandBouleCalibrationToNativePatch } from './projectGrandBouleCalibrationToNativePatch';

/**
 * Hydrate an offline Grand Boule worklet with the morph state and MIDI
 * calibration a live node gets from the project and the per-device store
 * respectively (#4302, #4310).
 *
 * Calibration is not `deviceState` — it lives only in
 * `createGrandBouleStore(deviceId)` — so this needs `deviceId` the same
 * reason `projectGrandBouleCalibrationToNativePatch` does. Posted after the
 * morph params, as separate `param` messages carrying the DSP's own names
 * (`sustain_threshold`, `cc_smoothing_ms`): `grandBouleEngineCore.ts`'s
 * `dispatch` forwards a `param` message's name straight to `set_param` when
 * it is not one of the camelCase keys `PARAM_MAP` translates, which neither
 * calibration name is, so these reach the same `set_param` arms the morph
 * params do. No store for this device means the DSP's own defaults are
 * already correct, so nothing is posted.
 */
export function prepareOfflineGrandBoule({
    deviceId,
    deviceState,
    port,
}: {
    deviceId: string;
    deviceState: unknown;
    port: MessagePort;
}): void {
    const morph = readGrandBouleMorphState(deviceState);
    for (const parameter of projectGrandBouleMorphState(morph)) {
        port.postMessage({ type: 'param', ...parameter });
    }
    const calibration = projectGrandBouleCalibrationToNativePatch({ deviceId });
    if (calibration === null) {
        return;
    }
    for (const [name, value] of Object.entries(calibration)) {
        port.postMessage({ type: 'param', name, value });
    }
}
