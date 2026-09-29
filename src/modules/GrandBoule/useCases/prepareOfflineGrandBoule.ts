import { projectGrandBouleMorphState } from '../models/ProjectGrandBouleMorphState';

import { captureOfflineGrandBoule } from './captureOfflineGrandBoule';

/**
 * Hydrate an offline Grand Boule worklet with the morph state the project
 * holds and the temperament, preset voicing and MIDI calibration a live node
 * gets from the per-device store (#4302, #4310, #4727).
 *
 * Calibration is not `deviceState` — it lives only in
 * `createGrandBouleStore(deviceId)` — so this needs `deviceId` the same
 * reason `projectGrandBouleCalibrationToNativePatch` does. The temperament
 * and the preset parameters ride the same capture (`voicing`) — the
 * per-device store's when the device is live, the project's persisted chunk
 * otherwise (#4727) — so an export plays the tuning and voicing the project
 * saved even before any engine load. Posted after the
 * morph params, as separate `param` messages carrying the DSP's own names
 * (`sustain_threshold`, `cc_smoothing_ms`): `grandBouleEngineCore.ts`'s
 * `dispatch` forwards a `param` message's name straight to `set_param` when
 * it is not one of the camelCase keys `PARAM_MAP` translates, which neither
 * calibration name nor any preset parameter is, so these reach the same
 * `set_param` arms the morph params do. The temperament travels as the
 * dedicated `temperament` message instead, the form the live node posts and
 * `dispatch` handles in its own arm.
 */
export function prepareOfflineGrandBoule({
    deviceId,
    deviceState,
    port,
    captured,
}: {
    deviceId: string;
    deviceState: unknown;
    port: MessagePort;
    captured?: ReturnType<typeof captureOfflineGrandBoule>;
}): void {
    const { morph, calibration, voicing } = captured ?? captureOfflineGrandBoule({ deviceId, deviceState });
    for (const parameter of projectGrandBouleMorphState(morph)) {
        port.postMessage({ type: 'param', ...parameter });
    }
    port.postMessage({ type: 'temperament', index: voicing.temperament });
    port.postMessage({ type: 'param', name: 'hammer_hardness', value: voicing.parameters.hammerHardness });
    port.postMessage({ type: 'param', name: 'tone_tilt', value: voicing.parameters.toneTilt });
    port.postMessage({ type: 'param', name: 'stereo_width', value: voicing.parameters.stereoWidth });
    port.postMessage({ type: 'param', name: 'velocity_curve', value: voicing.parameters.velocityCurve });
    if (calibration === null) {
        return;
    }
    for (const [name, value] of Object.entries(calibration)) {
        port.postMessage({ type: 'param', name, value });
    }
}
