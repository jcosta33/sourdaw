import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { type DisplayMode } from '../models/TunerState';
import { mergeDeviceState } from '../stores/tunerStore';

/**
 * `ScoringEngine::set_param` names on the tuner's wasm engine. `poly` gates
 * the per-string tracker; `instrument` 0 selects the six-string guitar set the
 * panel labels. The tracker ships with no strings configured, so enabling
 * `poly` without first selecting the instrument would report zero strings
 * forever — hence the instrument write rides ahead of the enable.
 */
const POLY_PARAM_ID = 'poly';
const INSTRUMENT_PARAM_ID = 'instrument';
const GUITAR_STANDARD_INSTRUMENT = 0;

/**
 * Turn the engine's polyphonic tracker on or off for this device.
 *
 * Display mode is panel chrome, so this is deliberately a live engine write
 * and not a persisted device parameter: the transient branch of
 * `setA4Reference` is the same shape. The `resolveEligibleDeviceWriteTarget`
 * gate exists for the same reason it does there — a device id owned by no
 * track, owned twice, or held by an ineligible track kind has no write target,
 * and pushing anyway writes to whichever device answers first. Leaving Poly
 * switches the tracker off: it costs per-string analysis the other displays
 * never read.
 */
function drivePolyDetector(deviceId: string, enabled: boolean): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    if (enabled) {
        updateDeviceParam(target.trackId, target.deviceId, INSTRUMENT_PARAM_ID, GUITAR_STANDARD_INSTRUMENT);
    }
    updateDeviceParam(target.trackId, target.deviceId, POLY_PARAM_ID, enabled ? 1 : 0);
}

export function setDisplayMode(deviceId: string, mode: DisplayMode): void {
    mergeDeviceState(deviceId, { mode });
    drivePolyDetector(deviceId, mode === 'poly');
}
