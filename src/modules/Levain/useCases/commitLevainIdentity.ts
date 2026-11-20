import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { captureDevicePatchCommitValidation, getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/stores';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { type LevainIdentitySnapshot, type SetLevainIdentityAction } from '../events/levainAppActions';
import { LEVAIN_DEVICE_STATE_VERSION, LEVAIN_MISSING_DEVICE_STATE } from '../models/LevainDeviceState';
import { readLevainIdentityCapture } from '../models/LevainIdentityCapture';
import { type ArticulationType, createDefaultPatch, type InstrumentId } from '../models/LevainPatch';

import { levainBridge } from './levainParamBridge/levainBridge';
import { projectLevainPresetParameters } from './projectLevainPresetParameters';

type Selection =
    | { kind: 'articulation'; articulation: ArticulationType }
    | { kind: 'instrument'; instrumentId: InstrumentId; name: string };

type CurrentIdentity = NonNullable<ReturnType<typeof readLevainIdentityCapture>>;
type SelectionPatch = Pick<SetLevainIdentityAction['payload'], 'label' | 'after'>;

function compileSelection(
    selection: Selection,
    before: LevainIdentitySnapshot,
    identity: CurrentIdentity,
    parameterValues: LevainIdentitySnapshot['parameterValues']
): SelectionPatch | null {
    const patch = createDefaultPatch(selection.kind === 'instrument' ? selection.instrumentId : identity.instrumentId);
    const articulation = patch.articulations.find(
        ({ type }) => type === (selection.kind === 'instrument' ? patch.currentArticulation : selection.articulation)
    );
    if (!articulation || (selection.kind === 'articulation' && articulation.type === identity.articulation)) {
        return null;
    }
    const label =
        selection.kind === 'instrument' ? `Load ${selection.name}` : `Select ${articulation.name} articulation`;
    return {
        label,
        after: {
            deviceState: {
                version: LEVAIN_DEVICE_STATE_VERSION,
                data: {
                    ...before.deviceState?.data,
                    instrumentId: patch.instrumentId,
                    currentArticulation: articulation.type,
                },
            },
            parameterValues,
        },
    };
}

/** Compile a single visible selection against the current project and registered owner. */
export async function commitLevainIdentity(deviceId: string, selection: Selection): Promise<void> {
    const owner = resolveEligibleDeviceWriteTarget(deviceId);
    const isRegistered = levainBridge().captureRegistration(deviceId);
    if (owner.status !== 'eligible' || !isRegistered()) {
        notifyUser('This Levain device is no longer available.', 'warning');
        return;
    }
    const parameterValues =
        selection.kind === 'instrument'
            ? projectLevainPresetParameters(createDefaultPatch(selection.instrumentId))
            : {};
    const parameterIds = Object.keys(parameterValues);
    const current = getPlannedDevicePatchState({ deviceId, trackId: owner.trackId, parameterIds });
    if (current?.deviceType !== 'levain' || current.frozen) {
        notifyUser('This Levain track is frozen or no longer available.', 'warning');
        return;
    }
    const before = current.state;
    const identity = readLevainIdentityCapture(before.deviceState);
    if (!identity) {
        notifyUser('This Levain instrument state cannot be edited by this version.', 'warning');
        return;
    }
    const patch = compileSelection(selection, before, identity, parameterValues);
    if (!patch || valuesEqual(before, patch.after)) {
        return;
    }
    const { trackId, deviceIds } = current;
    const authority = captureDevicePatchCommitValidation({
        deviceId,
        trackId,
        parameterIds,
        requireCurrentProjection: true,
    });
    if (!authority) {
        notifyUser('This Levain device changed before its selection could be saved.', 'warning');
        return;
    }
    const root = captureProjectRootIdentity();
    function runtimeIsCurrent(): boolean {
        return captureProjectRootIdentity() === root && isRegistered();
    }
    try {
        await executeUserAppAction(
            {
                type: 'setLevainIdentity',
                payload: {
                    kind: selection.kind,
                    trackId,
                    deviceId,
                    deviceIds,
                    before,
                    missingDeviceState: LEVAIN_MISSING_DEVICE_STATE,
                    ...patch,
                },
            },
            {
                shouldExecute: () => runtimeIsCurrent() && authority.isCurrent(),
                shouldCommit: runtimeIsCurrent,
                skipMacroRecording: true,
            }
        );
    } catch (error) {
        logger.error(new Error('Levain selection failed', { cause: error }));
        notifyUser('Could not change this Levain selection.', 'error');
    }
}
