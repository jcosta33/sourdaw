import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { findDeviceRef } from './helpers';

/**
 * Send engine_type directly to the worklet (bypasses rAF throttle).
 * Used by sound locks which need immediate engine swap before triggering.
 * Does NOT update the store — the pad's stored engineType remains the default.
 */
export function setPadEngineImmediate(deviceId: string, padIndex: number, engineIdx: number): void {
    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const dn = strip.deviceNodes.find((data) => data.toasterControls && data.toasterControls.ready !== undefined);
    if (dn?.toasterControls) {
        dn.toasterControls.setPadParam(padIndex, 'engine_type', engineIdx);
    }
}
