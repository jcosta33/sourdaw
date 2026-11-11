import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type FermenterPatch } from '../models/FermenterPatch';
import {
    cloneFermenterPatch,
    fermenterPatchesEqual,
    readFermenterPatchFromProjectDevice,
    toFermenterDeviceState,
} from '../models/FermenterPatchState';
import { fermenterStore } from '../stores/fermenterStore';

import { cancelPendingFermenterPatchWrites } from './fermenterParamBridge/loadFermenterPatchWithAudio';

export type CommitFermenterPatchInput = {
    deviceId: string;
    patch: FermenterPatch;
    label: string;
};

const pendingCommits = new Map<string, { superseded: boolean }>();

function currentProjectPatch(deviceId: string): FermenterPatch | null {
    const device = (trackStore.value?.tracks ?? [])
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'fermenter');
    return device ? readFermenterPatchFromProjectDevice(device) : null;
}

/** Commit one discrete whole-patch edit. Continuous macro and morph gestures keep their own bridge. */
export async function commitFermenterPatch(input: CommitFermenterPatchInput): Promise<boolean> {
    const target = resolveEligibleDeviceWriteTarget(input.deviceId);
    if (target.status !== 'eligible') {
        notifyUser('The Fermenter device is missing or cannot be changed.', 'warning');
        return false;
    }
    const owner = trackStore.value?.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === input.deviceId);
    if (!owner || device?.type !== 'fermenter') {
        notifyUser('The Fermenter device changed before the patch could be applied.', 'warning');
        return false;
    }
    if (owner.frozen === true) {
        notifyUser('Unfreeze the track before changing its Fermenter patch.', 'warning');
        return false;
    }

    const projectBefore = readFermenterPatchFromProjectDevice(device);
    const before = cloneFermenterPatch(fermenterStore.value?.[input.deviceId]?.patch ?? projectBefore);
    const after = cloneFermenterPatch(input.patch);
    const olderCommit = pendingCommits.get(input.deviceId);
    if (olderCommit) {
        olderCommit.superseded = true;
    }
    if (fermenterPatchesEqual(before, after)) {
        return true;
    }

    cancelPendingFermenterPatchWrites(input.deviceId);
    const pendingCommit = { superseded: false };
    pendingCommits.set(input.deviceId, pendingCommit);
    const authority = captureProjectTransitionAuthority();
    const revision = captureProjectRevision();
    try {
        await executeUserAppAction(
            {
                type: 'setFermenterPatch',
                payload: {
                    deviceId: input.deviceId,
                    before: toFermenterDeviceState(before),
                    after: toFermenterDeviceState(after),
                    expectedCurrent: toFermenterDeviceState(projectBefore),
                    expectedTrackId: owner.id,
                    expectedDeviceIds: owner.devices.map((candidate) => candidate.id),
                    expectedTrackFrozen: owner.frozen ?? false,
                    label: input.label,
                },
            },
            {
                shouldExecute: () =>
                    !pendingCommit.superseded && authority.isCurrent() && captureProjectRevision() === revision,
            }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Fermenter patch change failed', 'error');
        return false;
    } finally {
        if (pendingCommits.get(input.deviceId) === pendingCommit) {
            pendingCommits.delete(input.deviceId);
        }
    }
    const current = currentProjectPatch(input.deviceId);
    return !pendingCommit.superseded && current !== null && fermenterPatchesEqual(current, after);
}
