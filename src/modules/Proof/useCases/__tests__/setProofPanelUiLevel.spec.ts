import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { getProofState, proofStore, setProofUiLevel } from '../../stores/proofStore';
import { hydrateProofDisclosureFromProject } from '../hydrateProofDisclosureFromProject';
import { setProofPanelUiLevel } from '../setProofPanelUiLevel';

import type { Device, TrackStoreState } from '#/modules/Arrangement/stores';

function tracksWithTwoProofDevices() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'a',
                        name: 'Proof A',
                        type: 'proof',
                        bypassed: false,
                        parameterValues: { lim_ceiling: -2, input_gain: 1 },
                        deviceState: { version: 1, data: { unrelated: 'preserve' } },
                    },
                    { id: 'b', name: 'Proof B', type: 'proof', bypassed: false, parameterValues: {} },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

function projectState(deviceId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId)
        ?.deviceState;
}

function rawProjectState(deviceId: string) {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')
        ?.tracks.tracks.flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.deviceState;
}

function rawProjectTracks() {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks;
}

function withCollidingDevice(
    tracks: TrackStoreState['tracks'],
    type: string,
    version: number,
    acrossTracks: boolean,
    first = false
): TrackStoreState['tracks'] {
    const owner = tracks[0];
    if (!owner) {
        throw new Error('Missing fixture track');
    }
    const collision: Device = {
        id: 'a',
        name: 'Other device',
        type,
        bypassed: true,
        parameterValues: { input_gain: -6 },
        deviceState: { version, data: { disclosureTier: 'shape', unrelated: 'other', future: 'retain' } },
    };
    if (acrossTracks) {
        return [...tracks, { ...owner, id: 'track-2', devices: [collision] }];
    }
    return [
        { ...owner, devices: first ? [collision, ...owner.devices] : [...owner.devices, collision] },
        ...tracks.slice(1),
    ];
}

async function requestDuringSnapshotEdit(
    edit: (state: TrackStoreState) => TrackStoreState,
    afterEdit?: () => void
): Promise<void> {
    let allowEdit!: () => void;
    let releaseTransaction!: () => void;
    let markStarted!: () => void;
    let markEdited!: () => void;
    const editAllowed = new Promise<void>((resolve) => {
        allowEdit = resolve;
    });
    const transactionRelease = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
    });
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const edited = new Promise<void>((resolve) => {
        markEdited = resolve;
    });
    const transaction = transactSnapshot(async (snapshotTransaction) => {
        markStarted();
        await editAllowed;
        const storageTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            trackStore.set(edit(trackStore.value!));
        });
        storageTransaction.commit();
        markEdited();
        await transactionRelease;
    });
    await started;
    const request = setProofPanelUiLevel('a', 5);
    allowEdit();
    await edited;
    afterEdit?.();
    releaseTransaction();
    await transaction;
    await request;
}

describe('setProofPanelUiLevel project path', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Proof disclosure integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        agentProjectRepairStateStore.set(null);
        vi.mocked(notifyUser).mockClear();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        proofStore.set({});
        setProofUiLevel({ deviceId: 'a', level: 1 });
        setProofUiLevel({ deviceId: 'b', level: 1 });
        trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoProofDevices() });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        agentProjectRepairStateStore.set(null);
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
    });

    it('restores distinct addressed tiers from saved Automerge binary bytes after session loss', async () => {
        await setProofPanelUiLevel('a', 5);
        await setProofPanelUiLevel('b', 2);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve', disclosureTier: 'lab' } });
        expect(projectState('b')).toEqual({ version: 1, data: { disclosureTier: 'shape' } });
        expect(getProofState('a').uiLevel).toBe(1);

        const source = getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root');
        if (!source) {
            throw new Error('Missing project document');
        }
        const bytes = Automerge.save(source);
        const loaded = Automerge.load<{ tracks: Pick<TrackStoreState, 'tracks'> }>(bytes);
        const projected = sanitizeTrackSnapshot(Automerge.toJS(loaded).tracks);
        resetCrdtProjectAuthority('Binary-restored Proof project');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        flushAutomergeStorageWrites();
        proofStore.set({});
        setProofUiLevel({ deviceId: 'a', level: 1 });
        setProofUiLevel({ deviceId: 'b', level: 1 });
        hydrateProofDisclosureFromProject('a');
        hydrateProofDisclosureFromProject('b');
        expect(getProofState('a').uiLevel).toBe(5);
        expect(getProofState('b').uiLevel).toBe(2);
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({ lim_ceiling: -2, input_gain: 1 });
    });

    it('hydrates disclosure without replacing the live patch', async () => {
        const engine = getProofState('a').patch;
        await setProofPanelUiLevel('a', 4);
        hydrateProofDisclosureFromProject('a');
        expect(getProofState('a').uiLevel).toBe(4);
        expect(getProofState('a').patch).toBe(engine);
    });

    it('persists the latest rapid choice for one device after snapshot work releases', async () => {
        let markStarted!: () => void;
        let releaseTransaction!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });
        const before = trackStore.value?.tracks[0]?.devices[0];
        const transaction = transactSnapshot(async () => {
            markStarted();
            await release;
        });
        await started;

        const shape = setProofPanelUiLevel('a', 2);
        const route = setProofPanelUiLevel('a', 4);
        releaseTransaction();
        await transaction;
        await Promise.all([shape, route]);

        expect(rawProjectState('a')).toEqual({
            version: 1,
            data: { unrelated: 'preserve', disclosureTier: 'route' },
        });
        expect(projectState('a')).toEqual(rawProjectState('a'));
        expect(projectState('b')).toBeUndefined();
        const after = trackStore.value?.tracks[0]?.devices[0];
        expect(after?.parameterValues).toEqual(before?.parameterValues);
        expect(after?.bypassed).toBe(before?.bypassed);
        proofStore.set({});
        setProofUiLevel({ deviceId: 'a', level: 1 });
        setProofUiLevel({ deviceId: 'b', level: 1 });
        hydrateProofDisclosureFromProject('a');
        expect(getProofState('a').uiLevel).toBe(4);
    });

    it('refuses an unknown state version without replacing or disclosing a choice', async () => {
        const tracks = tracksWithTwoProofDevices();
        const device = tracks[0]?.devices[0];
        if (!device) {
            throw new Error('Missing fixture device');
        }
        device.deviceState = { version: 99, data: { disclosureTier: 'lab', future: 'value' } };
        trackStore.set({ ...defaultTrackState, tracks });

        await setProofPanelUiLevel('a', 4);
        expect(projectState('a')).toEqual({ version: 99, data: { disclosureTier: 'lab', future: 'value' } });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('newer version'), 'warning');
        hydrateProofDisclosureFromProject('a');
        expect(getProofState('a').uiLevel).toBe(1);
    });

    it('does not create state for a missing device', async () => {
        await setProofPanelUiLevel('missing', 5);
        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
    });

    it.each([
        { type: 'proof', version: 1, acrossTracks: false, first: false },
        { type: 'proof', version: 1, acrossTracks: true, first: false },
        { type: 'eq', version: 1, acrossTracks: false, first: true },
        { type: 'eq', version: 99, acrossTracks: false, first: false },
        { type: 'eq', version: 99, acrossTracks: true, first: false },
    ])('refuses duplicate ids without altering any record: %j', async ({ type, version, acrossTracks, first }) => {
        trackStore.set({
            ...defaultTrackState,
            tracks: withCollidingDevice(tracksWithTwoProofDevices(), type, version, acrossTracks, first),
        });
        flushAutomergeStorageWrites();
        const before = structuredClone(trackStore.value!.tracks);
        const patch = getProofState('a').patch;

        await setProofPanelUiLevel('a', 5);

        expect(trackStore.value?.tracks).toEqual(before);
        expect(rawProjectTracks()).toEqual(before);
        expect(getProofState('a').uiLevel).toBe(1);
        expect(getProofState('a').patch).toBe(patch);
    });

    it('leaves a standalone wrong-kind device and its future metadata unchanged', async () => {
        const tracks = tracksWithTwoProofDevices();
        const device = tracks[0]?.devices[0];
        if (!device) {
            throw new Error('Missing fixture device');
        }
        device.type = 'eq';
        device.deviceState = { version: 99, data: { future: 'retain' } };
        trackStore.set({ ...defaultTrackState, tracks });
        flushAutomergeStorageWrites();
        const before = structuredClone(trackStore.value!.tracks);

        await setProofPanelUiLevel('a', 5);

        expect(trackStore.value?.tracks).toEqual(before);
        expect(rawProjectTracks()).toEqual(before);
        expect(getProofState('a').uiLevel).toBe(1);
    });

    it.each([
        { type: 'proof', version: 1, acrossTracks: false },
        { type: 'proof', version: 1, acrossTracks: true },
        { type: 'eq', version: 99, acrossTracks: false },
        { type: 'eq', version: 99, acrossTracks: true },
    ])('refuses a duplicate introduced during snapshot admission: %j', async ({ type, version, acrossTracks }) => {
        const initialState = trackStore.value!;
        const device = initialState.tracks[0]?.devices[0];
        let before: TrackStoreState['tracks'] = [];
        let projectedState = initialState;

        await requestDuringSnapshotEdit(
            () => {
                const tracks = withCollidingDevice(initialState.tracks, type, version, acrossTracks);
                before = structuredClone(tracks);
                projectedState = { ...initialState, tracks };
                return projectedState;
            },
            () => {
                // Keep the captured object so duplicate admission, rather than replacement identity, decides refusal.
                vi.spyOn(trackStore, 'value', 'get').mockReturnValue(projectedState);
            }
        );

        expect(trackStore.value?.tracks[0]?.devices[0]).toBe(device);
        expect(trackStore.value?.tracks).toEqual(before);
        expect(rawProjectTracks()).toEqual(before);
        expect(getProofState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });

    it('leaves project and visible tier unchanged when the command admission refuses', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        await setProofPanelUiLevel('a', 5);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(getProofState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(
            'Project repair is required before project actions can execute',
            'warning'
        );
    });

    it('keeps a newer device state committed while disclosure waits for a snapshot', async () => {
        const newerState = { version: 99, data: { disclosureTier: 'shape', future: 'value' } };
        await requestDuringSnapshotEdit((state) => ({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) =>
                    device.id === 'a' ? { ...device, deviceState: newerState } : device
                ),
            })),
        }));

        expect(rawProjectState('a')).toEqual(newerState);
        expect(projectState('a')).toEqual(newerState);
        expect(getProofState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });

    it('keeps a same-version metadata edit committed while disclosure waits', async () => {
        const newerState = { version: 1, data: { unrelated: 'newer', future: 'value' } };
        await requestDuringSnapshotEdit((state) => ({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) =>
                    device.id === 'a' ? { ...device, deviceState: newerState } : device
                ),
            })),
        }));

        expect(rawProjectState('a')).toEqual(newerState);
        expect(projectState('a')).toEqual(newerState);
        expect(getProofState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });

    it('does not address a replacement device that reuses the captured id', async () => {
        const replacement = { version: 1, data: { unrelated: 'preserve' } };
        await requestDuringSnapshotEdit((state) => ({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) =>
                    device.id === 'a' ? { ...device, name: 'Replacement Proof', deviceState: replacement } : device
                ),
            })),
        }));

        expect(rawProjectState('a')).toEqual(replacement);
        expect(projectState('a')).toEqual(replacement);
        expect(trackStore.value?.tracks[0]?.devices[0]?.name).toBe('Replacement Proof');
        expect(getProofState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });

    it('does not carry a pending choice into a successor project with the same device id', async () => {
        let markStarted!: () => void;
        let releaseTransaction!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });
        const transaction = transactSnapshot(async () => {
            markStarted();
            await release;
        });
        await started;

        const request = setProofPanelUiLevel('a', 4);
        const capturedState = trackStore.value!;
        const capturedDevice = capturedState.tracks[0]?.devices[0];
        resetCrdtProjectAuthority('Successor Proof project');
        trackStore.set(capturedState);
        flushAutomergeStorageWrites();
        // Isolate project authority from the separate object-replacement guard.
        vi.spyOn(trackStore, 'value', 'get').mockReturnValue(capturedState);
        expect(trackStore.value?.tracks[0]?.devices[0]).toBe(capturedDevice);
        releaseTransaction();
        await transaction;
        await request;

        expect(rawProjectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(projectState('a')).toEqual(rawProjectState('a'));
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });
});
