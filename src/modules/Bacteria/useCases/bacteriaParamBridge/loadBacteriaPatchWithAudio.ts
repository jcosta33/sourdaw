import { inject } from '#/infra/di/inject';

import { type BacteriaBand, type BacteriaPatch } from '../../models/BacteriaPatch';
import { getBacteriaState, loadBacteriaPatch } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { encodePatchValue } from './helpers';

import type { DeviceRef, PersistDeviceParamFn, UpdateDeviceParamFn } from './helpers';

/**
 * Top-level `BacteriaPatch` keys that are NOT scalar audio parameters and so
 * are never pushed to the engine as a single `(paramId, value)` message:
 *   - `name`            — display label, no audio meaning
 *   - `bands`           — array; pushed per-band below with a `band{i}_` prefix
 *   - `modAssignments`  — UI/persistence-only routing metadata (see BacteriaPatch.ts)
 *   - `snapshots`       — UI/persistence-only XY-morph metadata (see BacteriaPatch.ts)
 *
 * Every other key is a scalar (number / boolean / enum-string) the engine
 * understands. Iterating the patch keys minus this set — instead of a parallel
 * hand-maintained string list — guarantees new scalar params (e.g. lfo1Sync /
 * lfo2Sync) are pushed without a second edit, and that the two lists can never
 * silently drift apart.
 */
const NON_SCALAR_GLOBAL_KEYS = new Set<keyof BacteriaPatch>(['name', 'bands', 'modAssignments', 'snapshots']);

/**
 * Per-band keys that are not scalar audio parameters: `convolutionIr` is an IR
 * identifier string with no numeric encoding (encodePatchValue returns null for
 * it), so it is excluded explicitly rather than relying on the null guard.
 */
const NON_SCALAR_BAND_KEYS = new Set<keyof BacteriaBand>(['convolutionIr']);

function createPushParamImmediately(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

export const loadBacteriaPatchWithAudio = inject(bacteriaParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    const pushParamImmediately = createPushParamImmediately(updateDeviceParamFn, persistDeviceParamFn);
    return function loadBacteriaPatchWithAudio(deviceId: string, patch: BacteriaPatch): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        // The session store mirrors interactive engine writes, while project
        // parameter values survive reopen and collaboration. A parameter is
        // safe to skip only when both available views already match the preset.
        const previousPatch = getBacteriaState(deviceId).patch;
        const projectParameterValues = getAllTracksFn()
            .find((track) => track.id === target.trackId)
            ?.devices.find((device) => device.id === target.deviceId)?.parameterValues;

        loadBacteriaPatch(deviceId, patch);

        for (const key of Object.keys(patch) as Array<keyof BacteriaPatch>) {
            if (NON_SCALAR_GLOBAL_KEYS.has(key)) {
                continue;
            }
            const rawValue = patch[key];
            const encodedValue = encodePatchValue(key, rawValue);
            if (encodedValue === null) {
                continue;
            }
            const previousEncoded = encodePatchValue(key, previousPatch[key]);
            const projectEncoded = projectParameterValues?.[key];
            if (previousEncoded === encodedValue && (projectEncoded === undefined || projectEncoded === encodedValue)) {
                continue;
            }
            pushParamImmediately(target, key, encodedValue);
        }

        // Only iterate the bands the new patch actually activates. The patch
        // array is always 6 entries (DEFAULT_PATCH never resizes it), so
        // pushing all 6 would send ~250 messages for bands the engine ignores.
        const activeBandCount = Math.max(0, Math.min(patch.bands.length, patch.bandCount));
        const previousActiveBandCount = Math.max(0, Math.min(previousPatch.bands.length, previousPatch.bandCount));
        for (let bandIndex = 0; bandIndex < activeBandCount; bandIndex += 1) {
            const band = patch.bands[bandIndex];
            if (!band) {
                continue;
            }
            // A band that was previously inactive may hold stale engine state
            // (prior loads only pushed the then-active bands), so the store
            // mirror is not a trustworthy diff baseline for it — push every
            // param to fully re-sync. Only diff bands that were already active.
            const previousBand = bandIndex < previousActiveBandCount ? previousPatch.bands[bandIndex] : undefined;

            for (const key of Object.keys(band) as Array<keyof BacteriaBand>) {
                if (NON_SCALAR_BAND_KEYS.has(key)) {
                    continue;
                }
                const encodedValue = encodePatchValue(key, band[key]);
                if (encodedValue === null) {
                    continue;
                }
                const previousEncoded = previousBand === undefined ? null : encodePatchValue(key, previousBand[key]);
                const prefixedKey = `band${bandIndex}_${key}`;
                const projectEncoded = projectParameterValues?.[prefixedKey];
                if (
                    previousEncoded === encodedValue &&
                    (projectEncoded === undefined || projectEncoded === encodedValue)
                ) {
                    continue;
                }
                pushParamImmediately(target, prefixedKey, encodedValue);
            }
        }
    };
});
