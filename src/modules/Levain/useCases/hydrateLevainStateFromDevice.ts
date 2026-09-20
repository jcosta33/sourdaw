import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { createDefaultPatch } from '../models/LevainPatch';
import { defaultLevainState, type LevainState } from '../stores/levainStore';

import { hydrateLevainPatchFromParameterValues } from './hydrateLevainPatchFromParameterValues';

type LevainDeviceInput = {
    deviceState?: unknown;
    parameterValues: Readonly<Record<string, number>>;
};

/** Reconstruct the owner state from a supplied device without consulting the live project. */
export function hydrateLevainStateFromDevice(device: LevainDeviceInput): LevainState {
    const identity = fromLevainDeviceState(device.deviceState);
    const instrumentId = identity?.instrumentId ?? defaultLevainState.patch.instrumentId;
    const defaultPatch = createDefaultPatch(instrumentId);
    const currentArticulation = identity?.currentArticulation ?? defaultPatch.currentArticulation;
    const patch = hydrateLevainPatchFromParameterValues({
        patch: { ...defaultPatch, currentArticulation },
        parameterValues: device.parameterValues,
    });
    const entry = patch.articulations.find((articulation) => articulation.type === currentArticulation);
    return {
        ...defaultLevainState,
        patch,
        currentArticulationDisplay: entry ? entry.name : currentArticulation,
    };
}
