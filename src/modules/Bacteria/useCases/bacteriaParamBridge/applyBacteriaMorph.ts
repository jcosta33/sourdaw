import { inject } from '#/infra/di/inject';

import { interpolateMorphSnapshot } from '../../models/MorphInterpolation';
import { getBacteriaState, setBacteriaParam } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { createFlushParam } from './createFlushParam';
import { paramBatcher } from './helpers';

/** Engine key of one active band's scalar: `band0_drive`, `band1_gain`, … */
const BAND_KEY = /^band(\d+)_(.+)$/;

/**
 * Move the XY morph pad to (x, y) and push the morph result.
 *
 * The position is stored in the patch; the interpolation itself is resolved
 * here in the UI (`interpolateMorphSnapshot`) and each resulting scalar is
 * scheduled through the same rAF batcher and flush the panel's param bridges
 * use — one ordinary `(paramId, value)` engine write per parameter per frame,
 * no more dropout-prone than a knob drag. A parameter a corner gap leaves out
 * of the morph result is simply not written: the engine keeps whatever value
 * it was last given.
 *
 * Interpolated values are engine writes only — they deliberately do not
 * rewrite the patch's typed band fields, the way a macro's output is not the
 * knob positions it moves.
 */
export const applyBacteriaMorphWithAudio = inject(bacteriaParamBridgeDependencies)(({
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn, resolveEligibleDeviceWriteTargetFn);
    return function applyBacteriaMorphWithAudio(deviceId: string, x: number, y: number): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setBacteriaParam(deviceId, 'morphX', x);
        setBacteriaParam(deviceId, 'morphY', y);

        const patch = getBacteriaState(deviceId).patch;
        const morphed = interpolateMorphSnapshot(x, y, patch.snapshots);
        for (const [key, value] of Object.entries(morphed)) {
            const bandMatch = BAND_KEY.exec(key);
            if (bandMatch && Number(bandMatch[1]) >= patch.bandCount) {
                // The band left the sum after its corner was captured; writing
                // its params would only stage them for a later count change.
                continue;
            }

            const compositeKey = `${target.deviceId}:${key}`;
            paramBatcher.schedule(compositeKey, { deviceId: target.deviceId, key, value }, flushParam);
        }
    };
});
