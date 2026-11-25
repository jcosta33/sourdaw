import { getHeads, getObjectId } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { type HandlerCommitValidation } from '#/utils/handlerContract';
import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { projectCapturedDevicePatch } from '../../models/CapturedDevicePatchProjection';
import { type DevicePatchState } from '../../models/DevicePatchState';
import { trackStore } from '../../stores/trackStore';

import { readDevicePatchSnapshot } from './readDevicePatchSnapshot';

type Input = Parameters<typeof readDevicePatchSnapshot>[1] & {
    requireCurrentProjection?: boolean;
};
type Snapshot = NonNullable<ReturnType<typeof readDevicePatchSnapshot>>;

function matchesOwnerFootprint(current: Snapshot | null, before: Snapshot): boolean {
    return (
        valuesEqual(current?.value.track, before.value.track) &&
        current?.track?.kind === before.track?.kind &&
        current?.owners[0]?.device.type === before.owners[0]?.device.type
    );
}

function matchesParameterValues(stored: unknown, parameters: Readonly<DevicePatchState['parameterValues']>): boolean {
    return (
        isRecord(stored) &&
        Object.entries(parameters).every(([key, value]) =>
            value === null ? !Object.hasOwn(stored, key) : Object.hasOwn(stored, key) && stored[key] === value
        )
    );
}

function startWrittenIntentObservation(
    input: Input,
    before: Snapshot,
    trackIdentity: ReturnType<typeof getObjectId> | undefined,
    deviceIdentity: ReturnType<typeof getObjectId> | undefined,
    headsAtAdmission: ReturnType<typeof getHeads>,
    matchesSource: (document: Readonly<Record<string, unknown>>) => boolean
) {
    const owner = getCurrentAutomergeStorageMutationOwner();
    const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
    if (!owner || !current || !matchesSource(current)) {
        return null;
    }
    const projected = (): Snapshot | null => {
        const published = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
        return published ? readDevicePatchSnapshot({ ...published, tracks: trackStore.value }, input) : null;
    };
    let observed = projected();
    let expected: string | null = null;
    let observedHeads = getHeads(current).toSorted();
    let authorityIntervened = !valuesEqual(headsAtAdmission, observedHeads);
    let deviceRetired = before.owners.length === 0;
    let trackRetired = before.track === null;
    const observe = (): void => {
        const published = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
        if (!published) {
            observed = null;
            authorityIntervened = true;
            return;
        }
        const next = projected();
        const heads = getHeads(published).toSorted();
        // Matching mutation provenance alone cannot authenticate a peer hydration inside that scope.
        authorityIntervened ||= !valuesEqual(observedHeads, heads);
        if (
            expected !== null &&
            observed &&
            next &&
            !authorityIntervened &&
            getCurrentAutomergeStorageMutationOwner() === owner
        ) {
            deviceRetired ||= observed.owners.length > 0 && next.owners.length === 0;
            trackRetired ||= observed.track !== null && next.track === null;
            expected = JSON.stringify(next.value);
        }
        observed = next;
        observedHeads = heads;
    };
    const unsubscribe = trackStore.subscribe(observe);
    const sourceFailure = (): string | null => {
        const published = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
        return published && matchesSource(published) ? null : 'Device patch source changed before publication';
    };
    const validation: HandlerCommitValidation = {
        documentId: 'root',
        beforeCommit: sourceFailure,
        beforeMutation: (document) => (matchesSource(document) ? null : 'Device patch source changed before mutation'),
        validateDocument: (document) => {
            const next = readDevicePatchSnapshot(document, input);
            if (expected === null || !next || !matchesJsonFingerprint(next.value, expected)) {
                return 'Device patch did not reach its owned written intent';
            }
            if (!trackRetired && next.track && getObjectId(next.track) !== trackIdentity) {
                return 'Device patch track incarnation changed';
            }
            if (!deviceRetired && next.owners[0] && getObjectId(next.owners[0].device) !== deviceIdentity) {
                return 'Device patch incarnation changed';
            }
            return null;
        },
        release: unsubscribe,
    };
    return {
        validation,
        captureWrittenState(written: DevicePatchState): boolean {
            const tracks = trackStore.value?.tracks ?? [];
            const devices = tracks.flatMap((track) =>
                track.devices.filter((device) => device.id === input.deviceId).map((device) => ({ track, device }))
            );
            const target = devices.length === 1 ? devices[0] : undefined;
            if (
                !target ||
                target.track.id !== input.trackId ||
                !projectCapturedDevicePatch(target.device, written, written)
            ) {
                return false;
            }
            const next = projected();
            if (!next) {
                return false;
            }
            expected = JSON.stringify(next.value);
            observed = next;
            return true;
        },
    };
}

/** Capture published admission before any batch member yields; observe written intent only during execution. */
export function captureDevicePatchCommitValidation(input: Input) {
    const root = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
    const before = root ? readDevicePatchSnapshot(root, input) : null;
    if (!root || !before) {
        return null;
    }
    const fingerprint = JSON.stringify(before.value);
    if (input.requireCurrentProjection) {
        // An exact capture planned from a stale projection must not overwrite a
        // newer published owner, even if publication stands still during the write.
        const projected = readDevicePatchSnapshot({ ...root, tracks: trackStore.value }, input);
        if (!projected || !matchesJsonFingerprint(projected.value, fingerprint)) {
            return null;
        }
    }
    const trackIdentity = before.track ? getObjectId(before.track) : undefined;
    const deviceIdentity = before.owners[0] ? getObjectId(before.owners[0].device) : undefined;
    const transition = projectTransitionEpoch.captureEditAuthority();
    if (!transition.isCurrent()) {
        return null;
    }
    const identity = captureProjectIdentity();
    const headsAtAdmission = getHeads(root).toSorted();
    function matchesOwner(current: Snapshot | null): boolean {
        return (
            transition.isCurrent() &&
            captureProjectIdentity() === identity &&
            current !== null &&
            (current.track ? getObjectId(current.track) : undefined) === trackIdentity &&
            (current.owners[0] ? getObjectId(current.owners[0].device) : undefined) === deviceIdentity
        );
    }
    const matchesSource = (document: Readonly<Record<string, unknown>>): boolean => {
        const current = readDevicePatchSnapshot(document, input);
        return current !== null && matchesOwner(current) && matchesJsonFingerprint(current.value, fingerprint);
    };
    return {
        isCurrent: (): boolean => {
            const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
            return current !== undefined && matchesSource(current);
        },
        matchesCommittedParameters: (parameters: Readonly<DevicePatchState['parameterValues']>): boolean => {
            const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
            const snapshot = current ? readDevicePatchSnapshot(current, input) : null;
            return (
                typeof trackIdentity === 'string' &&
                typeof deviceIdentity === 'string' &&
                matchesOwner(snapshot) &&
                matchesOwnerFootprint(snapshot, before) &&
                matchesParameterValues(snapshot?.owners[0]?.device.parameterValues, parameters)
            );
        },
        start() {
            return startWrittenIntentObservation(
                input,
                before,
                trackIdentity,
                deviceIdentity,
                headsAtAdmission,
                matchesSource
            );
        },
    };
}
