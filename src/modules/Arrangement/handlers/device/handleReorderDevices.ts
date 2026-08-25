import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { applyDeviceChainRuntimeDelta } from '../../useCases/device/applyDeviceChainRuntimeDelta';
import { reorderDevicesInProject } from '../../useCases/device/reorderDevices';
import {
    getRuntimeDeviceDeltaPostCommitFailure,
    type RuntimeDeviceDeltaPostCommitError,
} from '../../useCases/device/runtimeDeviceDeltaPostCommit';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { runtimeGraphTopology } from '../../useCases/runtimeGraphTopology';
import { getPlannedTrackState } from '../getPlannedTrackState';

type ReorderDevicesAction = Extract<AppAction, { type: 'reorderDevices' }>;

function getUniqueCurrentTrack(trackId: string): Track | null {
    const owners = (getTrackStoreState()?.tracks ?? []).filter((track) => track.id === trackId);
    return owners.length === 1 ? owners[0]! : null;
}

function hasUniqueDeviceIds(track: Track): boolean {
    const deviceIds = track.devices.map((device) => device.id);
    return new Set(deviceIds).size === deviceIds.length;
}

function hasUniqueParameterIds(action: ReorderDevicesAction): boolean {
    return action.payload.expectedBefore.devices.every(
        (device) => new Set(device.parameterIds).size === device.parameterIds.length
    );
}

function resolveReorder(
    action: ReorderDevicesAction,
    context?: HandlerValidationContext
): { track: Track; sourceIndex: number } | null {
    if (
        action.payload.expectedProjectRevision !== undefined &&
        action.payload.expectedProjectRevision !== captureProjectRevision()
    ) {
        return null;
    }
    const current = getUniqueCurrentTrack(action.payload.trackId);
    const track = context ? getPlannedTrackState(context, action.payload.trackId) : current;
    if (
        !current ||
        !track ||
        !getTrackEligibility(track.kind).acceptsDeviceUpdate ||
        !hasUniqueDeviceIds(current) ||
        !hasUniqueDeviceIds(track) ||
        !hasUniqueParameterIds(action) ||
        !runtimeGraphTopology.matchesNode(track, action.payload.expectedBefore)
    ) {
        return null;
    }
    const sourceIndices = track.devices.flatMap((device, index) =>
        device.id === action.payload.deviceId ? [index] : []
    );
    if (
        sourceIndices.length !== 1 ||
        !Number.isInteger(action.payload.targetIndex) ||
        action.payload.targetIndex < 0 ||
        action.payload.targetIndex >= track.devices.length
    ) {
        return null;
    }
    return { track, sourceIndex: sourceIndices[0]! };
}

function moveDevice(track: Track, sourceIndex: number, targetIndex: number): Track {
    const devices = [...track.devices];
    const [device] = devices.splice(sourceIndex, 1);
    if (!device) {
        return track;
    }
    devices.splice(targetIndex, 0, device);
    return { ...track, devices };
}

function moveTopology(
    before: ReorderDevicesAction['payload']['expectedBefore'],
    deviceId: string,
    targetIndex: number
): ReorderDevicesAction['payload']['expectedBefore'] | null {
    const sourceIndices = before.devices.flatMap((device, index) => (device.id === deviceId ? [index] : []));
    if (sourceIndices.length !== 1 || targetIndex < 0 || targetIndex >= before.devices.length) {
        return null;
    }
    const devices = [...before.devices];
    const [device] = devices.splice(sourceIndices[0]!, 1);
    if (!device) {
        return null;
    }
    devices.splice(targetIndex, 0, device);
    return { ...before, devices };
}

export const handleReorderDevices = createHandler<'reorderDevices'>({
    validate: (action, context) => resolveReorder(action, context) !== null,
    execute: (action, context) => {
        const resolution = resolveReorder(action);
        if (!resolution) {
            return { status: 'conflict' };
        }
        if (resolution.sourceIndex === action.payload.targetIndex) {
            return { status: 'no-write' };
        }

        const before = structuredClone(resolution.track);
        const after = moveDevice(before, resolution.sourceIndex, action.payload.targetIndex);
        // The initial dispatch's revision is intentionally consumed once. Its
        // inverse and redo retain exact topology proofs and may run at a later
        // project revision through the same guarded handler.
        delete action.payload.expectedProjectRevision;
        reorderDevicesInProject(before.id, after);

        if (!shouldCreateLiveTrackStrip(before)) {
            return { status: 'written' as const };
        }

        let postCommitFailure: RuntimeDeviceDeltaPostCommitError | undefined;
        function applyRuntimeEffect(): void {
            if (postCommitFailure) {
                throw postCommitFailure;
            }
            const result = applyDeviceChainRuntimeDelta({
                before,
                after,
                operation: 'reorder-device',
                batchContext: context,
            });
            // A later action in this same commit removed the host track, so the
            // chain this reorder describes no longer exists in project truth and
            // the strip it would reorder is being torn down by that action.
            if (result.acceptance === 'superseded') {
                return;
            }
            const runtimeFailure = getRuntimeDeviceDeltaPostCommitFailure(result);
            if (runtimeFailure) {
                postCommitFailure = runtimeFailure;
                throw postCommitFailure;
            }
        }

        return {
            status: 'written' as const,
            afterCommit: applyRuntimeEffect,
            afterAmbiguousCommit: applyRuntimeEffect,
        };
    },
    describe: (action) => {
        const sourceIndex = action.payload.expectedBefore.devices.findIndex(
            (device) => device.id === action.payload.deviceId
        );
        const after = moveTopology(action.payload.expectedBefore, action.payload.deviceId, action.payload.targetIndex);
        return {
            label: 'Reorder devices',
            inverseAction:
                sourceIndex >= 0 && after
                    ? {
                          type: 'reorderDevices',
                          payload: {
                              trackId: action.payload.trackId,
                              deviceId: action.payload.deviceId,
                              targetIndex: sourceIndex,
                              expectedBefore: after,
                          },
                      }
                    : null,
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
