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

type Input = { trackId: string; deviceId: string; parameterIds: readonly string[] };
type Located = { trackId: string; device: Record<string, unknown> };
type Snapshot = {
    value: { track: unknown; owners: unknown[] };
    track: Record<string, unknown> | null;
    owners: Located[];
};

function entry(record: Record<string, unknown>, key: string) {
    return Object.hasOwn(record, key) ? { present: true, value: record[key] } : { present: false };
}

function read(document: Readonly<Record<string, unknown>>, input: Input): Snapshot | null {
    if (!isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const owners: Located[] = [];
    const values: unknown[] = [];
    let selectedTrack: Record<string, unknown> | null = null;
    let trackValue: unknown = { present: false };
    for (const track of document.tracks.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.devices)) {
            return null;
        }
        const deviceIds = track.devices.map((device: unknown) => (isRecord(device) ? device.id : undefined));
        if (deviceIds.some((id) => typeof id !== 'string')) {
            return null;
        }
        if (track.id === input.trackId) {
            if (selectedTrack) {
                return null;
            }
            selectedTrack = track;
            trackValue = { present: true, deviceIds, frozen: entry(track, 'frozen') };
        }
        for (const device of track.devices) {
            if (!isRecord(device) || device.id !== input.deviceId) {
                continue;
            }
            if (!isRecord(device.parameterValues)) {
                return null;
            }
            const parameters: Record<string, unknown> = {};
            for (const key of input.parameterIds) {
                parameters[key] = entry(device.parameterValues, key);
            }
            owners.push({ trackId: track.id, device });
            values.push({ trackId: track.id, type: device.type, state: entry(device, 'deviceState'), parameters });
        }
    }
    if (owners.length > 1) {
        return null;
    }
    return { value: { track: trackValue, owners: values }, track: selectedTrack, owners };
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
        return published ? read({ ...published, tracks: trackStore.value }, input) : null;
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
            const next = read(document, input);
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
    const before = root ? read(root, input) : null;
    if (!root || !before) {
        return null;
    }
    const fingerprint = JSON.stringify(before.value);
    const trackIdentity = before.track ? getObjectId(before.track) : undefined;
    const deviceIdentity = before.owners[0] ? getObjectId(before.owners[0].device) : undefined;
    const transition = projectTransitionEpoch.captureEditAuthority();
    if (!transition.isCurrent()) {
        return null;
    }
    const identity = captureProjectIdentity();
    const headsAtAdmission = getHeads(root).toSorted();
    const matchesSource = (document: Readonly<Record<string, unknown>>): boolean => {
        const current = read(document, input);
        return (
            transition.isCurrent() &&
            captureProjectIdentity() === identity &&
            current !== null &&
            matchesJsonFingerprint(current.value, fingerprint) &&
            (current.track ? getObjectId(current.track) : undefined) === trackIdentity &&
            (current.owners[0] ? getObjectId(current.owners[0].device) : undefined) === deviceIdentity
        );
    };
    return {
        isCurrent: (): boolean => {
            const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
            return current !== undefined && matchesSource(current);
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
