import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import {
    type DeviceOwnerIncarnation,
    type HandlerCommitValidation,
    type HandlerDeviceOwnerChange,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type Track } from '../../models/Track';

import { readRawDevicePatchOwner } from './readRawDevicePatchOwner';

type Target = Parameters<typeof readRawDevicePatchOwner>[1];
type Guard = NonNullable<HandlerCommitValidation['beforeMutation']>;
type Rebind = (owner: HandlerDeviceOwnerChange) => void;
type Chain = Pick<Track, 'id' | 'devices'>;
type Reorder = { kind: 'reorder'; before: Chain; after: Chain; rebind: Rebind };
type Change =
    | { kind: 'remove'; target: Target; removed: DeviceOwnerIncarnation }
    | { kind: 'restore'; target: Target; removed: DeviceOwnerIncarnation; rebind: Rebind }
    | Reorder;

function validateCommit(source: Guard, validateDocument: Guard, rebind?: () => void): HandlerCommitValidation | null {
    const identity = captureProjectIdentity();
    function beforeMutation(document: Parameters<Guard>[0]): string | null {
        return captureProjectIdentity() === identity
            ? source(document)
            : 'The project changed during device history replay';
    }
    function beforeCommit(): string | null {
        const root = getCrdtDoc('root');
        return root ? beforeMutation(root) : 'The project root disappeared during device history replay';
    }
    if (beforeCommit() !== null) {
        return null;
    }
    return {
        documentId: 'root',
        beforeCommit,
        beforeMutation,
        validateDocument,
        release: () => undefined,
        afterPublication:
            rebind &&
            (() => {
                if (captureProjectIdentity() === identity) {
                    rebind();
                }
            }),
    };
}

function captureRemoval(target: Target, removed: DeviceOwnerIncarnation) {
    return validateCommit(
        (document) => {
            const owner = readRawDevicePatchOwner(document, target);
            return owner?.trackObjectId === removed.trackObjectId &&
                owner.deviceObjectId === removed.deviceObjectId &&
                owner.deviceType === 'grinder'
                ? null
                : 'The Grinder being removed changed';
        },
        (document) => {
            const owner = readRawDevicePatchOwner(document, target);
            return owner?.trackObjectId === removed.trackObjectId && owner.deviceObjectId === null
                ? null
                : 'The recorded Grinder removal did not retire its owner';
        }
    );
}

function captureRestoration(target: Target, removed: DeviceOwnerIncarnation, rebind: Rebind) {
    let restored: DeviceOwnerIncarnation | null = null;
    return validateCommit(
        (document) => {
            const owner = readRawDevicePatchOwner(document, target);
            return owner?.trackObjectId === removed.trackObjectId && owner.deviceObjectId === null
                ? null
                : 'The recorded Grinder restoration no longer has its original empty slot';
        },
        (document) => {
            const owner = readRawDevicePatchOwner(document, target);
            if (
                owner?.trackObjectId !== removed.trackObjectId ||
                !owner.deviceObjectId ||
                owner.deviceObjectId === removed.deviceObjectId ||
                owner.deviceType !== 'grinder'
            ) {
                return 'The recorded Grinder restoration did not create a new owner';
            }
            restored = { trackObjectId: owner.trackObjectId, deviceObjectId: owner.deviceObjectId };
            return null;
        },
        () => {
            if (restored) {
                rebind({ ...target, previous: removed, current: restored });
            }
        }
    );
}

function readGrinderOwners(
    document: Parameters<Guard>[0],
    trackId: string,
    deviceIds: readonly string[],
    expectedChain: readonly string[]
) {
    const owners: DeviceOwnerIncarnation[] = [];
    for (const deviceId of deviceIds) {
        const owner = readRawDevicePatchOwner(document, { trackId, deviceId });
        if (owner?.deviceType !== 'grinder' || !owner.deviceObjectId || !valuesEqual(owner.deviceIds, expectedChain)) {
            return null;
        }
        owners.push({ trackObjectId: owner.trackObjectId, deviceObjectId: owner.deviceObjectId });
    }
    return owners;
}

function captureReorder({ before, after, rebind }: Reorder) {
    const trackId = before.id;
    const deviceIds = before.devices.filter(({ type }) => type === 'grinder').map(({ id }) => id);
    const originalChain = before.devices.map(({ id }) => id);
    const reorderedChain = after.devices.map(({ id }) => id);
    const root = getCrdtDoc('root');
    const previousOwners = root ? readGrinderOwners(root, trackId, deviceIds, originalChain) : null;
    if (!previousOwners?.length) {
        return null;
    }
    let transferredOwners: HandlerDeviceOwnerChange[] = [];
    return validateCommit(
        (document) =>
            valuesEqual(readGrinderOwners(document, trackId, deviceIds, originalChain), previousOwners)
                ? null
                : 'The Grinder owner or device chain changed before reorder',
        (document) => {
            const currentOwners = readGrinderOwners(document, trackId, deviceIds, reorderedChain);
            if (!currentOwners) {
                return 'The recorded reorder did not establish the expected device chain';
            }
            const transferred: HandlerDeviceOwnerChange[] = [];
            for (const [index, deviceId] of deviceIds.entries()) {
                const previous = previousOwners[index];
                const current = currentOwners[index];
                if (!previous || !current || current.trackObjectId !== previous.trackObjectId) {
                    return 'The Grinder track changed during reorder';
                }
                if (current.deviceObjectId !== previous.deviceObjectId) {
                    transferred.push({ trackId, deviceId, previous, current });
                }
            }
            transferredOwners = transferred;
            return null;
        },
        () => {
            for (const owner of transferredOwners) {
                rebind(owner);
            }
        }
    );
}

export function captureDeviceHistoryCommitValidation(change: Change) {
    switch (change.kind) {
        case 'remove':
            return captureRemoval(change.target, change.removed);
        case 'restore':
            return captureRestoration(change.target, change.removed, change.rebind);
        case 'reorder':
            return captureReorder(change);
    }
}
