import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { holdWebFallbackDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

import { type BacteriaFactoryPatchAction } from '../../events/bacteriaAppActions';
import { fromBacteriaModAssignmentsState } from '../../models/BacteriaModAssignmentsState';
import { mapBacteriaModAssignments } from '../../models/BacteriaModulationIds';
import { hydrateBacteriaPatchFromProject } from '../hydrateBacteriaPatchFromProject';

import { bacteriaFactoryParameters } from './bacteriaFactoryParameters';
import { paramBatcher } from './helpers';

/** Reconcile a still-current, published factory write through the existing carriers. */
export function reconcileBacteriaFactoryPatch(payload: BacteriaFactoryPatchAction['payload']): void {
    const { trackId, deviceId, before, after } = payload;
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible' || target.trackId !== trackId) {
        return;
    }
    const values = bacteriaFactoryParameters.replayValues(before.parameterValues, after.parameterValues);
    const rows = fromBacteriaModAssignmentsState(after.deviceState) ?? [];
    for (const [key, value] of Object.entries(values)) {
        paramBatcher.cancel(`${deviceId}:${key}`);
        holdWebFallbackDeviceParam(trackId, deviceId, key, value);
    }
    const mapped = mapBacteriaModAssignments(rows);
    const patch = mapped ? { ...values, modAssignments: mapped } : values;
    updateDevicePatch(trackId, deviceId, patch);
    hydrateBacteriaPatchFromProject(deviceId, { name: after.name, parameterValues: values, modAssignments: rows });
}
