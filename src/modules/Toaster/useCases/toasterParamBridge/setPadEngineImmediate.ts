import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { findReadyToasterControlsOnStrip } from './findReadyToasterControlsOnStrip';

/**
 * Send engine_type directly to the worklet (bypasses rAF throttle).
 * Used by sound locks which need immediate engine swap before triggering.
 * Does NOT update the store — the pad's stored engineType remains the default.
 */
export function setPadEngineImmediate(deviceId: string, padIndex: number, engineIdx: number): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const strip = getTrackStrip(target.trackId);
    if (!strip) {
        return;
    }
    const controls = findReadyToasterControlsOnStrip({ strip, deviceId });
    if (controls) {
        controls.setPadParam(padIndex, 'engine_type', engineIdx);
    }
}
