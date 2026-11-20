import { load, save } from '@automerge/automerge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { batchStoreUpdates } from '#/infra/store/createStore';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, persistDeviceParam, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
    replaceCrdtDoc,
    projectCrdtToStores,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { levainStore } from '../../stores/levainStore';
import { configureLevainDeviceStateProjectAccess } from '../configureLevainDeviceStateProjectAccess';
import { hydrateLevainStateFromProject } from '../hydrateLevainStateFromProject';
import { reconcileLevainDeviceStateFromProject } from '../reconcileLevainDeviceStateFromProject';
import { setLevainPanelUiLevel } from '../setLevainPanelUiLevel';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

function tracksWithTwoLevainDevices() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'a',
                        name: 'Levain A',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: {
                            version: 1,
                            data: { instrumentId: 'cello', currentArticulation: 'pizzicato', unrelated: 'preserve' },
                        },
                    },
                    {
                        id: 'b',
                        name: 'Levain B',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: { version: 1, data: { instrumentId: 'horn', currentArticulation: 'staccato' } },
                    },
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

function rawProjectDevice(deviceId: string) {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')
        ?.tracks.tracks.flatMap((track) => track.devices)
        .find((device) => device.id === deviceId);
}

function rawProjectState(deviceId: string) {
    return rawProjectDevice(deviceId)?.deviceState;
}

async function requestDuringSnapshotEdit(
    edit: ((state: TrackStoreState, snapshotTransaction: object) => TrackStoreState | void) | null,
    requestAction: (snapshotTransaction: object) => Promise<void> = () => setLevainPanelUiLevel('a', 6)
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
    let snapshotOwner: object | undefined;
    let editFailure: { error: unknown } | undefined;
    const transaction = transactSnapshot(async (snapshotTransaction) => {
        snapshotOwner = snapshotTransaction;
        markStarted();
        await editAllowed;
        try {
            const storageTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
                if (edit) {
                    const next = edit(trackStore.value!, snapshotTransaction);
                    if (next) {
                        trackStore.set(next);
                    }
                }
            });
            if (storageTransaction.status === 'threw') {
                storageTransaction.abort();
                throw storageTransaction.error;
            }
            storageTransaction.commit();
        } catch (error) {
            editFailure = { error };
        } finally {
            markEdited();
        }
        await transactionRelease;
    });
    await started;
    if (!snapshotOwner) {
        throw new Error('Expected active snapshot owner');
    }
    const request = requestAction(snapshotOwner);
    allowEdit();
    await edited;
    releaseTransaction();
    await transaction;
    await request;
    if (editFailure) {
        throw editFailure.error;
    }
}

async function requestAcrossSuccessorProject(requestAction: () => Promise<void>): Promise<void> {
    const originalState = trackStore.value!;
    const originalOwner = originalState.tracks[0];
    const originalDevice = originalOwner?.devices[0];
    const originalProjectIdentity = captureProjectIdentity();
    const originalDeviceState = structuredClone(rawProjectState('a'));
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

    const request = requestAction();
    let successorProjectIdentity = '';
    let sameOwner = false;
    let sameDevice = false;
    let successorDeviceState: ReturnType<typeof rawProjectState>;
    try {
        const root = getCrdtDoc('root');
        if (!root) {
            throw new Error('Expected an authoritative root document');
        }
        replaceCrdtDoc({ id: 'root', doc: load(save(root)) });
        successorProjectIdentity = captureProjectIdentity();
        sameOwner = trackStore.value?.tracks[0] === originalOwner;
        sameDevice = trackStore.value?.tracks[0]?.devices[0] === originalDevice;
        successorDeviceState = rawProjectState('a');
    } finally {
        releaseTransaction();
        await transaction;
    }
    await request;
    expect(successorProjectIdentity).not.toBe(originalProjectIdentity);
    expect(sameOwner).toBe(true);
    expect(sameDevice).toBe(true);
    expect(successorDeviceState).toEqual(originalDeviceState);
    expect(rawProjectState('a')).toEqual(originalDeviceState);
    expect(projectState('a')).toEqual(originalDeviceState);
}

const dispatched = vi.hoisted(() => [] as Promise<void>[]);
const tierCompletion = vi.hoisted(() => ({
    hold: null as { committed: () => void; release: Promise<void> } | null,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeUserAppAction: (...args: Parameters<typeof original.executeUserAppAction>) => {
            const hold = tierCompletion.hold;
            tierCompletion.hold = null;
            const request = original.executeUserAppAction(...args).then(async () => {
                if (hold) {
                    hold.committed();
                    await hold.release;
                }
            });
            dispatched.push(request);
            return request;
        },
    };
});

function editDevice(
    state: TrackStoreState,
    change: (
        device: TrackStoreState['tracks'][number]['devices'][number]
    ) => TrackStoreState['tracks'][number]['devices'][number]
): TrackStoreState {
    return {
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            devices: track.devices.map((device) => (device.id === 'a' ? change(device) : device)),
        })),
    };
}

const committedMembershipEvents: boolean[] = [];

beforeEach(() => {
    committedMembershipEvents.length = 0;
    configureLevainDeviceStateProjectAccess({
        hasDevice: (ownerId, deviceId) => {
            const document = getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root');
            return (
                document?.tracks.tracks
                    .find((track) => track.id === ownerId)
                    ?.devices.some((device) => device.id === deviceId && device.type === 'levain') === true
            );
        },
        subscribe: (listener) =>
            subscribeToCrdtChanges((id) => {
                if (id === undefined || id === 'root') {
                    committedMembershipEvents.push(rawProjectDevice('a')?.type === 'levain');
                    listener();
                }
            }),
    });
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Levain disclosure integration');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    registerProjectSlotProjections();
    agentProjectRepairStateStore.set(null);
    vi.mocked(notifyUser).mockClear();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    dispatched.length = 0;
    tierCompletion.hold = null;
    trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoLevainDevices() });
    flushAutomergeStorageWrites();
    levainStore.set({ a: hydrateLevainStateFromProject('a')!, b: hydrateLevainStateFromProject('b')! });
});

afterEach(async () => {
    configureLevainDeviceStateProjectAccess(null);
    agentProjectRepairStateStore.set(null);
    trackStore.set({ ...defaultTrackState, tracks: [] });
    flushAutomergeStorageWrites();
    levainStore.set({});
    removeCrdtDoc('root');
    configureAutomergeStoragePort(null);
});

it('roundtrips two distinct tiers and patches through the actual document codec and hydration', async () => {
    await setLevainPanelUiLevel('a', 6);
    await setLevainPanelUiLevel('b', 1);
    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
        disclosureTier: 'expert',
        unrelated: 'preserve',
    });
    expect(rawProjectState('b')?.data).toMatchObject({
        instrumentId: 'horn',
        currentArticulation: 'staccato',
        disclosureTier: 'basic',
    });
    // A successful void action never paints the session before authoritative projection.
    expect(levainStore.value?.a?.uiLevel).toBe(1);
    reconcileLevainDeviceStateFromProject('a');
    expect(levainStore.value?.a?.uiLevel).toBe(6);
    const document = getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')!;
    const bytes = save(document);
    removeCrdtDoc('root');
    levainStore.set({});
    replaceCrdtDoc({ id: 'root', doc: load(bytes) });
    projectCrdtToStores();
    expect(hydrateLevainStateFromProject('a')).toMatchObject({
        uiLevel: 6,
        patch: { instrumentId: 'cello', currentArticulation: 'pizzicato' },
    });
    expect(hydrateLevainStateFromProject('b')).toMatchObject({
        uiLevel: 1,
        patch: { instrumentId: 'horn', currentArticulation: 'staccato' },
    });
});

it('does not paint a denied action or create a missing device', async () => {
    const before = projectState('a');
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'repair',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [],
        status: 'repair-required',
    });
    await setLevainPanelUiLevel('a', 6);
    await setLevainPanelUiLevel('missing', 6);
    expect(rawProjectState('a')).toEqual(before);
    expect(levainStore.value?.a?.uiLevel).toBe(1);
    expect(notifyUser).toHaveBeenCalledWith('Project repair is required before project actions can execute', 'warning');
});

it('saves a tier while real gain and mic writes replace its projected device', async () => {
    await requestDuringSnapshotEdit(() => {
        persistDeviceParam('a', 'masterGain', 0.52);
        persistDeviceParam('a', 'mic0Volume', 0.31);
    });
    expect(rawProjectState('a')?.data.disclosureTier).toBe('expert');
    expect(rawProjectDevice('a')?.parameterValues).toMatchObject({ masterGain: 0.52, mic0Volume: 0.31 });
});

it.each([1, 99])('preserves queued peer identity and metadata in version %i during a tier write', async (version) => {
    const peer = { version, data: { instrumentId: 'flute', currentArticulation: 'staccato', unrelated: 'newer' } };
    await requestDuringSnapshotEdit((state) => editDevice(state, (device) => ({ ...device, deviceState: peer })));
    expect(rawProjectState('a')).toEqual(peer);
    expect(projectState('a')).toEqual(peer);
    expect(levainStore.value?.a?.uiLevel).toBe(1);
});

it('keeps a tier request for the same entity when its projection is cloned', async () => {
    const before = structuredClone(projectState('a'));
    await requestDuringSnapshotEdit((state) => editDevice(state, (device) => structuredClone(device)));
    // The projection clone neither removes the UUID nor changes its persisted identity.
    expect(rawProjectState('a')?.data).toMatchObject({ ...before?.data, disclosureTier: 'expert' });
    expect(projectState('a')).toEqual(rawProjectState('a'));
});

it('does not carry a queued tier into a successor project retaining identical device objects and bytes', async () => {
    await requestAcrossSuccessorProject(() => setLevainPanelUiLevel('a', 6));
    expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
});

it('commits the newest valid tier choice when two choices wait behind one snapshot', async () => {
    await requestDuringSnapshotEdit(
        () => {
            persistDeviceParam('a', 'masterGain', 0.52);
        },
        async () => {
            const expert = setLevainPanelUiLevel('a', 6);
            const basic = setLevainPanelUiLevel('a', 1);
            await Promise.all([expert, basic]);
        }
    );

    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
        disclosureTier: 'basic',
        unrelated: 'preserve',
    });
    expect(projectState('a')).toEqual(rawProjectState('a'));
    expect(rawProjectDevice('a')?.parameterValues).toMatchObject({ masterGain: 0.52 });
    reconcileLevainDeviceStateFromProject('a');
    expect(levainStore.value?.a?.uiLevel).toBe(1);
});

it('refuses unknown versions before a tier request', async () => {
    const peer = { version: 99, data: { future: 'preserve' } };
    trackStore.set(editDevice(trackStore.value!, (device) => ({ ...device, deviceState: peer })));
    flushAutomergeStorageWrites();
    await setLevainPanelUiLevel('a', 6);
    expect(rawProjectState('a')).toEqual(peer);
    expect(dispatched).toHaveLength(0);
    expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('newer version'), 'warning');
});

function commitTopology(tracks: TrackStoreState['tracks'], snapshotTransaction: object): void {
    const write = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
        trackStore.set({ ...trackStore.value!, tracks });
    });
    if (write.status === 'threw') {
        write.abort();
        throw write.error;
    }
    try {
        write.commit();
    } catch (error) {
        write.abort();
        throw error;
    }
    projectCrdtToStores();
}

it('retires an already submitted tier request after committed removal and identical restore', async () => {
    const original = structuredClone(rawProjectState('a'));
    await requestDuringSnapshotEdit((state, transaction) => {
        const tracks = structuredClone(state.tracks);
        commitTopology(
            tracks.map((track) => ({
                ...track,
                devices: track.devices.filter((device) => device.id !== 'a'),
            })),
            transaction
        );
        expect(rawProjectDevice('a')).toBeUndefined();
        expect(committedMembershipEvents.at(-1)).toBe(false);
        commitTopology(tracks, transaction);
        expect(rawProjectState('a')).toEqual(original);
    });
    expect(rawProjectState('a')).toEqual(original);
    expect(levainStore.value?.a?.uiLevel).toBe(1);
});

it('observes separate committed remove and restore while projection notifications batch', async () => {
    const original = structuredClone(rawProjectState('a'));
    const projected = vi.fn();
    const unsubscribe = trackStore.subscribe(projected);
    try {
        await requestDuringSnapshotEdit((state, transaction) => {
            const tracks = structuredClone(state.tracks);
            batchStoreUpdates(() => {
                commitTopology(
                    tracks.map((track) => ({
                        ...track,
                        devices: track.devices.filter((device) => device.id !== 'a'),
                    })),
                    transaction
                );
                expect(rawProjectDevice('a')).toBeUndefined();
                commitTopology(tracks, transaction);
                expect(projected).not.toHaveBeenCalled();
            });
            expect(projected).toHaveBeenCalledTimes(1);
        });
        expect(rawProjectState('a')).toEqual(original);
        expect(levainStore.value?.a?.uiLevel).toBe(1);
    } finally {
        unsubscribe();
    }
});

it.each(['owner', 'type'] as const)('retires a queued choice after committed %s loss and restore', async (loss) => {
    const original = structuredClone(rawProjectState('a'));
    await requestDuringSnapshotEdit((state, transaction) => {
        const tracks = structuredClone(state.tracks);
        let absent: TrackStoreState['tracks'];
        if (loss === 'owner') {
            absent = tracks.map((track) => ({ ...track, id: 'different-owner' }));
        } else {
            absent = editDevice(state, (device) => ({ ...device, type: 'crust' })).tracks;
        }
        commitTopology(absent, transaction);
        commitTopology(tracks, transaction);
    });
    expect(rawProjectState('a')).toEqual(original);
});

it('keeps a queued choice after an optimistic removal is aborted without committed loss', async () => {
    await requestDuringSnapshotEdit((state, transaction) => {
        const optimistic = runWithAutomergeStorageTransaction(transaction, () => {
            trackStore.set({ ...state, tracks: [] });
        });
        expect(trackStore.value?.tracks).toEqual([]);
        expect(rawProjectDevice('a')).toBeDefined();
        optimistic.abort();
        expect(trackStore.value?.tracks[0]?.devices[0]?.id).toBe('a');
    });
    expect(rawProjectState('a')?.data.disclosureTier).toBe('expert');
});

it.each(['commit', 'abort'] as const)(
    'handles a fresh visible uncommitted restore when its storage transaction will %s',
    async (outcome) => {
        const state = structuredClone(trackStore.value!);
        const original = structuredClone(rawProjectState('a'));
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.filter((device) => device.id !== 'a'),
            })),
        });
        flushAutomergeStorageWrites();
        expect(rawProjectDevice('a')).toBeUndefined();
        await requestDuringSnapshotEdit(null, async (transaction) => {
            const restore = runWithAutomergeStorageTransaction(transaction, () => trackStore.set(state));
            expect(projectState('a')).toEqual(original);
            expect(rawProjectDevice('a')).toBeUndefined();
            const request = setLevainPanelUiLevel('a', 6);
            if (outcome === 'commit') {
                restore.commit();
            } else {
                restore.abort();
                expect(projectState('a')).toBeUndefined();
                const replacement = runWithAutomergeStorageTransaction(transaction, () => trackStore.set(state));
                replacement.commit();
            }
            expect(rawProjectState('a')).toEqual(original);
            await request;
        });
        if (outcome === 'commit') {
            expect(rawProjectState('a')?.data.disclosureTier).toBe('expert');
        } else {
            expect(rawProjectState('a')).toEqual(original);
            await setLevainPanelUiLevel('a', 6);
            expect(rawProjectState('a')?.data.disclosureTier).toBe('expert');
        }
    }
);

it('retires a second tier request when the first commit is followed by a committed owner loss', async () => {
    const committed = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    tierCompletion.hold = { committed: committed.resolve, release: release.promise };
    const first = setLevainPanelUiLevel('a', 6);
    await committed.promise;
    const second = setLevainPanelUiLevel('a', 1);
    const saved = structuredClone(rawProjectState('a'));
    const state = structuredClone(trackStore.value!);
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            devices: track.devices.filter((device) => device.id !== 'a'),
        })),
    });
    flushAutomergeStorageWrites();
    expect(rawProjectDevice('a')).toBeUndefined();
    trackStore.set(state);
    flushAutomergeStorageWrites();
    expect(rawProjectState('a')).toEqual(saved);
    // A different device remains independently writable while the old tail is held.
    await setLevainPanelUiLevel('b', 6);
    expect(rawProjectState('b')?.data.disclosureTier).toBe('expert');
    release.resolve();
    await Promise.all([first, second]);
    expect(rawProjectState('a')).toEqual(saved);
    expect(dispatched).toHaveLength(2);
});
