import {
    type DeviceWriteTargetResolution,
    resolveEligibleDeviceWriteTarget,
    trackStore,
} from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type FermenterPatch } from '../models/FermenterPatch';
import { captureFermenterPatchProjectState, projectFermenterPatchState } from '../models/FermenterPatchProjectState';
import {
    cloneFermenterPatch,
    fermenterPatchesEqual,
    readFermenterPatchFromProjectDevice,
    toFermenterDeviceState,
} from '../models/FermenterPatchState';
import { type PreparedFermenterPatchWrite } from '../models/PreparedFermenterPatchWrite';
import { fermenterStore } from '../stores/fermenterStore';

import { cancelPendingFermenterPatchWrites } from './fermenterParamBridge/cancelPendingFermenterPatchWrites';
import { fermenterPatchWriteOperations } from './fermenterPatchWriteOperations';
import { getFermenterDependencies } from './getFermenterDependencies';
import { reconcileFermenterPatchFromProject } from './reconcileFermenterPatchFromProject';

type PrepareFermenterPatchWriteInput = {
    deviceId: string;
    patch: FermenterPatch;
    label: string;
    continuous?: boolean;
};

function currentProjectPatch(deviceId: string): FermenterPatch | null {
    const device = (trackStore.value?.tracks ?? [])
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'fermenter');
    return device ? readFermenterPatchFromProjectDevice(device) : null;
}

function capturePatchWriteSource(input: PrepareFermenterPatchWriteInput) {
    let target: DeviceWriteTargetResolution;
    if (input.continuous) {
        target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(input.deviceId);
    } else {
        target = resolveEligibleDeviceWriteTarget(input.deviceId);
    }
    if (target.status !== 'eligible') {
        if (!input.continuous) {
            notifyUser('The Fermenter device is missing or cannot be changed.', 'warning');
        }
        return null;
    }
    const owner = trackStore.value?.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === input.deviceId);
    if (!owner || device?.type !== 'fermenter') {
        if (!input.continuous) {
            notifyUser('The Fermenter device changed before the patch could be applied.', 'warning');
        }
        return null;
    }
    if (owner.frozen === true) {
        if (!input.continuous) {
            notifyUser('Unfreeze the track before changing its Fermenter patch.', 'warning');
        }
        return null;
    }

    const admittedOwner = owner;
    const projectBefore = readFermenterPatchFromProjectDevice(device);
    const before = cloneFermenterPatch(
        input.continuous ? projectBefore : (fermenterStore.value?.[input.deviceId]?.patch ?? projectBefore)
    );
    const patch = cloneFermenterPatch(input.patch);
    const clamp = (key: string, value: number): number =>
        getFermenterDependencies().clampDeviceParameterValue({ deviceType: 'fermenter', paramId: key, value });
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value === 'number') {
            Object.assign(patch, { [key]: clamp(key, value) });
        }
    }
    const expectedProject = captureFermenterPatchProjectState(device);
    let beforeProject = expectedProject;
    if (!fermenterPatchesEqual(before, projectBefore)) {
        beforeProject = projectFermenterPatchState(expectedProject, projectBefore, before, clamp);
    }
    return { admittedOwner, device, projectBefore, before, patch, clamp, expectedProject, beforeProject };
}

type CommittablePatchWrite = Pick<
    PreparedFermenterPatchWrite,
    'patch' | 'action' | 'isCurrent' | 'reconcileRefusal' | 'markCommitted' | 'settle' | 'release'
>;

async function commitPreparedPatch(
    input: PrepareFermenterPatchWriteInput,
    projectBefore: FermenterPatch,
    write: CommittablePatchWrite
): Promise<boolean> {
    try {
        if (!write.isCurrent()) {
            write.reconcileRefusal();
            return false;
        }
        if (fermenterPatchesEqual(projectBefore, write.patch)) {
            return true;
        }
        await executeUserAppAction(write.action(), {
            shouldExecute: write.isCurrent,
            onCommitted: write.markCommitted,
            skipUndo: input.continuous === true,
            skipMacroRecording: input.continuous === true,
        });
        return write.settle();
    } catch (error) {
        write.reconcileRefusal();
        notifyUser(error instanceof Error ? error.message : 'Fermenter patch change failed', 'error');
        return false;
    } finally {
        write.release();
    }
}

function supersedePreviousWrite(input: PrepareFermenterPatchWriteInput): void {
    const olderCommit = fermenterPatchWriteOperations.get(input.deviceId);
    if (olderCommit) {
        olderCommit.superseded = true;
        if (!input.continuous && olderCommit.continuous && olderCommit.committedRevision === null) {
            // Settle the superseded draft while its owner is still current, before
            // the discrete action can queue and later refuse on a new revision.
            cancelPendingFermenterPatchWrites(input.deviceId);
            reconcileFermenterPatchFromProject(input.deviceId);
        }
    }
}

/** Capture an edit before a frame or Command transaction can yield to another owner. */
export function prepareFermenterPatchWrite(input: PrepareFermenterPatchWriteInput): PreparedFermenterPatchWrite | null {
    const source = capturePatchWriteSource(input);
    if (!source) {
        return null;
    }
    const { admittedOwner, device, projectBefore, before, patch, clamp, expectedProject, beforeProject } = source;
    supersedePreviousWrite(input);
    const authority = captureProjectTransitionAuthority();
    const identity = captureProjectIdentity();
    const revision = captureProjectRevision();
    const ownsProject = (): boolean => authority.isCurrent() && captureProjectIdentity() === identity;
    const pendingCommit: Parameters<typeof fermenterPatchWriteOperations.set>[1] = {
        superseded: false,
        continuous: input.continuous === true,
        patch,
        admittedRevision: revision,
        committedRevision: null,
        ownsProject,
    };
    fermenterPatchWriteOperations.set(input.deviceId, pendingCommit);

    function isCurrent(): boolean {
        return (
            !pendingCommit.superseded &&
            authority.isCurrent() &&
            captureProjectIdentity() === identity &&
            captureProjectRevision() === revision
        );
    }

    function reconcileRefusal(): void {
        const currentOwner = trackStore.value?.tracks.find((track) => track.id === admittedOwner.id);
        const currentDevice = currentOwner?.devices.find((candidate) => candidate.id === input.deviceId);
        if (!pendingCommit.superseded && ownsProject() && currentOwner?.frozen !== true && currentDevice === device) {
            reconcileFermenterPatchFromProject(input.deviceId);
        }
    }

    function action(): Extract<AppAction, { type: 'setFermenterPatch' }> {
        return {
            type: 'setFermenterPatch',
            payload: {
                deviceId: input.deviceId,
                before: toFermenterDeviceState(before),
                after: toFermenterDeviceState(patch),
                expectedCurrent: toFermenterDeviceState(projectBefore),
                beforeProject,
                afterProject: projectFermenterPatchState(expectedProject, projectBefore, patch, clamp),
                expectedProject,
                expectedTrackId: admittedOwner.id,
                expectedDeviceIds: admittedOwner.devices.map((candidate) => candidate.id),
                expectedTrackFrozen: admittedOwner.frozen ?? false,
                label: input.label,
            },
        };
    }

    function markCommitted(): void {
        pendingCommit.committedRevision = captureProjectRevision();
    }

    function settle(): boolean {
        const current = currentProjectPatch(input.deviceId);
        const committed =
            !pendingCommit.superseded && ownsProject() && current !== null && fermenterPatchesEqual(current, patch);
        if (!committed) {
            reconcileRefusal();
        }
        return committed;
    }

    function release(): void {
        if (
            fermenterPatchWriteOperations.get(input.deviceId) === pendingCommit &&
            pendingCommit.committedRevision === null
        ) {
            fermenterPatchWriteOperations.delete(input.deviceId);
        }
    }

    return {
        patch,
        action,
        isCurrent,
        markCommitted,
        settle,
        release,
        reconcileRefusal,
        cancelParameter(key: keyof FermenterPatch): void {
            const value = projectBefore[key];
            if (typeof value === 'number') {
                Object.assign(patch, { [key]: value });
            }
        },
        commit(): Promise<boolean> {
            return commitPreparedPatch(input, projectBefore, {
                patch,
                action,
                isCurrent,
                reconcileRefusal,
                markCommitted,
                settle,
                release,
            });
        },
    };
}
