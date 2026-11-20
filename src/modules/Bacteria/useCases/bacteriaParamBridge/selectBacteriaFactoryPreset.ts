import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { type BacteriaFactoryPatchAction, type BacteriaFactoryPatchSnapshot } from '../../events/bacteriaAppActions';
import {
    fromBacteriaModAssignmentsState,
    rowsEqual,
    toBacteriaModAssignmentsState,
} from '../../models/BacteriaModAssignmentsState';
import { getBacteriaState, setBacteriaParam } from '../../stores/bacteriaStore';
import { BACTERIA_PRESETS } from '../bacteriaPresets';

import { bacteriaFactoryParameters } from './bacteriaFactoryParameters';
import { readBacteriaFactoryPatchTarget } from './readBacteriaFactoryPatchTarget';
import { reconcileBacteriaFactoryPatch } from './reconcileBacteriaFactoryPatch';

type FactorySelection = {
    action: BacteriaFactoryPatchAction;
    parameterIds: readonly string[];
};

function prepareFactoryPreset(deviceId: string, preset: (typeof BACTERIA_PRESETS)[number]): FactorySelection | null {
    const desired = bacteriaFactoryParameters.presetValues(preset.patch);
    const parameterIds = bacteriaFactoryParameters.capturedIds(desired);
    const target = readBacteriaFactoryPatchTarget(deviceId, parameterIds);
    if (!target) {
        return null;
    }
    const chunk = target.state.deviceState;
    const session = getBacteriaState(deviceId).patch;
    const { before, after } = bacteriaFactoryParameters.captureValues(
        target.state.parameterValues,
        desired,
        bacteriaFactoryParameters.presetValues(session)
    );
    let afterChunk = chunk;
    if (!rowsEqual(fromBacteriaModAssignmentsState(chunk) ?? [], preset.patch.modAssignments)) {
        const replacement = toBacteriaModAssignmentsState(preset.patch.modAssignments);
        afterChunk = { ...replacement, data: { ...chunk?.data, ...replacement.data } };
    }
    return {
        parameterIds,
        action: {
            type: 'setBacteriaFactoryPatch',
            payload: {
                deviceId,
                trackId: target.trackId,
                deviceIds: target.deviceIds,
                label: `Load ${preset.name}`,
                before: { name: session.name, deviceState: chunk, parameterValues: before },
                after: { name: preset.name, deviceState: afterChunk, parameterValues: after },
            },
        },
    };
}

function sameProjectPatch(before: BacteriaFactoryPatchSnapshot, after: BacteriaFactoryPatchSnapshot): boolean {
    return (
        valuesEqual(before.deviceState, after.deviceState) && valuesEqual(before.parameterValues, after.parameterValues)
    );
}

export async function selectBacteriaFactoryPreset(deviceId: string, presetId: string): Promise<void> {
    const preset = BACTERIA_PRESETS.find(({ id }) => id === presetId);
    if (!preset) {
        return;
    }
    const selection = prepareFactoryPreset(deviceId, preset);
    if (!selection) {
        notifyUser('The Bacteria device is missing or cannot be changed.', 'warning');
        return;
    }
    const { action, parameterIds } = selection;
    const { trackId, before, after } = action.payload;
    const authority = captureDevicePatchCommitValidation({
        trackId,
        deviceId,
        parameterIds,
        requireCurrentProjection: true,
    });
    if (!authority?.isCurrent()) {
        notifyUser('Could not load the Bacteria preset while the project is changing.', 'warning');
        return;
    }
    try {
        if (!sameProjectPatch(before, after)) {
            await executeUserAppAction(action, {
                shouldExecute: authority.isCurrent,
                shouldCommit: authority.isCurrent,
                skipMacroRecording: true,
            });
        } else if (Object.keys(after.parameterValues).length > 0) {
            reconcileBacteriaFactoryPatch(action.payload);
        } else {
            setBacteriaParam(deviceId, 'name', after.name);
        }
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : `Could not load ${preset.name}.`, 'error');
    }
}
