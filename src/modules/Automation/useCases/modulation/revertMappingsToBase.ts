import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ModulatorMapping } from '../../models/Modulator';

import { getModulationDependencies } from './getModulationDependencies';
import { modulationParamSlew } from './modulationSlewState';
import { resolveModulationBinding } from './resolveModulationBinding';

/**
 * Write each mapping's persisted base value back to the engine once.
 *
 * The engine only ever sees modulated overrides (`applyModulationToEngine`
 * writes every tick while a mapping is live); removing the modulator or the
 * mapping simply stops the writes, which leaves the engine param frozen at the
 * last modulated value. This restores the persisted base so removal actually
 * "lets go" of the param. Called on removal paths, not on the scheduler hot
 * path. De-duplicates by destination so the same param is reverted once even if
 * several removed mappings target it.
 */
export function revertMappingsToBase(mappings: readonly ModulatorMapping[]): void {
    // If the engine seam has not been wired (e.g. before app bootstrap, or in a
    // unit test that never calls `setModulationDependencies`), there is no engine
    // to revert and nothing was ever written; removal is then a pure store edit.
    let deps: ReturnType<typeof getModulationDependencies>;
    try {
        deps = getModulationDependencies();
    } catch {
        return;
    }

    const reverted = new Set<string>();
    for (const mapping of mappings) {
        const key = `${mapping.targetTrackId} ${mapping.targetDeviceId} ${mapping.targetParamId}`;
        if (reverted.has(key)) {
            continue;
        }
        const binding = resolveModulationBinding(mapping);
        if (!binding) {
            continue;
        }
        const targetOwner = resolveEligibleDeviceWriteTarget(mapping.targetDeviceId);
        if (targetOwner.status !== 'eligible' || targetOwner.trackId !== mapping.targetTrackId) {
            continue;
        }
        reverted.add(key);
        // Drop the slew slot so a future re-add of this destination seeds fresh
        // at its new target rather than ramping from this now-stale value.
        modulationParamSlew.delete(key);
        deps.updateDeviceParam(targetOwner.trackId, targetOwner.deviceId, mapping.targetParamId, binding.baseValue);
    }
}
