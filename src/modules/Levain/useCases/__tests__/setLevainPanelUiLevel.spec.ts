import { load, save } from '@automerge/automerge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
    mutateCrdtDoc,
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

import { createDefaultPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { commitLevainDeviceState } from '../commitLevainDeviceState';
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
const identityCompletion = vi.hoisted(() => ({
    hold: null as { committed: () => void; release: Promise<void> } | null,
}));
const tierCompletion = vi.hoisted(() => ({
    hold: null as { committed: () => void; release: Promise<void> } | null,
}));
const submittedFacets = vi.hoisted(() => [] as ('identity' | 'tier')[]);
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeAppAction: (...args: Parameters<typeof original.executeAppAction>) => {
            submittedFacets.push('identity');
            const hold = identityCompletion.hold;
            identityCompletion.hold = null;
            const request = original.executeAppAction(...args).then(async () => {
                if (hold) {
                    hold.committed();
                    await hold.release;
                }
            });
            dispatched.push(request);
            return request;
        },
        executeUserAppAction: (...args: Parameters<typeof original.executeUserAppAction>) => {
            submittedFacets.push('tier');
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

const coordinated = vi.hoisted(() => [] as Promise<void>[]);
vi.mock('../coordinateLevainDeviceState', async (importOriginal) => {
    const original = await importOriginal<typeof import('../coordinateLevainDeviceState')>();
    return {
        coordinateLevainDeviceState: (...args: Parameters<typeof original.coordinateLevainDeviceState>) => {
            const request = original.coordinateLevainDeviceState(...args);
            coordinated.push(request);
            return request;
        },
    };
});

async function settleIdentityRequests(): Promise<void> {
    await Promise.all(coordinated);
}

function editedPatch(edit: string) {
    if (edit === 'instrument') {
        return createDefaultPatch('horn');
    }
    return { ...createDefaultPatch('cello'), currentArticulation: 'tremolo' as const };
}

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
    agentProjectRepairStateStore.set(null);
    vi.mocked(notifyUser).mockClear();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    dispatched.length = 0;
    coordinated.length = 0;
    identityCompletion.hold = null;
    tierCompletion.hold = null;
    submittedFacets.length = 0;
    trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoLevainDevices() });
    flushAutomergeStorageWrites();
    levainStore.set({ a: hydrateLevainStateFromProject('a')!, b: hydrateLevainStateFromProject('b')! });
});

afterEach(async () => {
    await settleIdentityRequests();
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

it('saves an identity while real gain and mic writes replace its projected device', async () => {
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
    await requestDuringSnapshotEdit(
        () => {
            persistDeviceParam('a', 'masterGain', 0.52);
            persistDeviceParam('a', 'mic0Volume', 0.31);
        },
        async () => {
            commitLevainDeviceState('a');
            await settleIdentityRequests();
        }
    );
    expect(rawProjectState('a')?.data).toMatchObject({ instrumentId: 'horn' });
    expect(rawProjectDevice('a')?.parameterValues).toMatchObject({ masterGain: 0.52, mic0Volume: 0.31 });
});

it('saves the latest identity and articulation queued behind one snapshot', async () => {
    await requestDuringSnapshotEdit(null, async () => {
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
        commitLevainDeviceState('a');
        levainStore.set({
            ...levainStore.value,
            a: { ...defaultLevainState, patch: { ...createDefaultPatch('cello'), currentArticulation: 'tremolo' } },
        });
        commitLevainDeviceState('a');
        await settleIdentityRequests();
    });
    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'tremolo',
    });
});

it('cancels a queued identity when the latest patch returns to the saved choice', async () => {
    await requestDuringSnapshotEdit(null, async () => {
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
        commitLevainDeviceState('a');
        levainStore.set({
            ...levainStore.value,
            a: { ...defaultLevainState, patch: { ...createDefaultPatch('cello'), currentArticulation: 'pizzicato' } },
        });
        commitLevainDeviceState('a');
        await settleIdentityRequests();
    });
    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
    });
});

it.each(['tier-first', 'identity-first'] as const)(
    'saves both local facets queued behind a real snapshot in %s order',
    async (order) => {
        await requestDuringSnapshotEdit(null, async () => {
            const identity = () => {
                levainStore.set({
                    ...levainStore.value,
                    a: { ...defaultLevainState, patch: createDefaultPatch('horn') },
                });
                commitLevainDeviceState('a');
            };
            if (order === 'identity-first') {
                identity();
            }
            const tier = setLevainPanelUiLevel('a', 6);
            if (order === 'tier-first') {
                identity();
            }
            await tier;
            await settleIdentityRequests();
        });
        expect(rawProjectState('a')?.data).toMatchObject({
            instrumentId: 'horn',
            currentArticulation: 'sustain',
            disclosureTier: 'expert',
            unrelated: 'preserve',
        });
        expect(projectState('a')).toEqual(rawProjectState('a'));
        expect(levainStore.value?.a?.uiLevel).toBe(1);
        reconcileLevainDeviceStateFromProject('a');
        expect(levainStore.value?.a?.uiLevel).toBe(6);
    }
);

it('refuses peer state arriving after its own identity commit but before the queued tier is created', async () => {
    let committed!: () => void;
    let release!: () => void;
    const ownCommit = new Promise<void>((resolve) => {
        committed = resolve;
    });
    const completion = new Promise<void>((resolve) => {
        release = resolve;
    });
    identityCompletion.hold = { committed, release: completion };
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
    commitLevainDeviceState('a');
    const tier = setLevainPanelUiLevel('a', 6);
    await ownCommit;
    expect(rawProjectState('a')?.data.instrumentId).toBe('horn');
    const peer = { version: 1, data: { instrumentId: 'flute', currentArticulation: 'staccato', unrelated: 'newer' } };
    trackStore.set(editDevice(trackStore.value!, (device) => ({ ...device, deviceState: peer })));
    flushAutomergeStorageWrites();
    release();
    await tier;
    await settleIdentityRequests();
    expect(rawProjectState('a')).toEqual(peer);
    expect(projectState('a')).toEqual(peer);
    expect(levainStore.value?.a?.uiLevel).toBe(1);
    expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
});

it('keeps newest facet choices and independent devices while both writers wait', async () => {
    await requestDuringSnapshotEdit(null, async () => {
        const expert = setLevainPanelUiLevel('a', 6);
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
        commitLevainDeviceState('a');
        const basic = setLevainPanelUiLevel('a', 1);
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: editedPatch('articulation') } });
        commitLevainDeviceState('a');
        const other = setLevainPanelUiLevel('b', 6);
        levainStore.set({ ...levainStore.value, b: { ...defaultLevainState, patch: createDefaultPatch('flute') } });
        commitLevainDeviceState('b');
        await Promise.all([expert, basic, other]);
        await settleIdentityRequests();
    });
    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'tremolo',
        disclosureTier: 'basic',
        unrelated: 'preserve',
    });
    expect(rawProjectState('b')?.data).toMatchObject({
        instrumentId: 'flute',
        currentArticulation: 'sustain',
        disclosureTier: 'expert',
    });
});

it('cancels a reverted pending identity without cancelling the pending tier', async () => {
    await requestDuringSnapshotEdit(null, async () => {
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
        commitLevainDeviceState('a');
        const tier = setLevainPanelUiLevel('a', 6);
        levainStore.set({
            ...levainStore.value,
            a: {
                ...defaultLevainState,
                patch: {
                    ...createDefaultPatch('cello'),
                    currentArticulation: 'pizzicato',
                },
            },
        });
        commitLevainDeviceState('a');
        await tier;
        await settleIdentityRequests();
    });
    expect(rawProjectState('a')?.data).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
        disclosureTier: 'expert',
    });
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

it.each([
    [1, 'instrument'],
    [1, 'articulation'],
    [99, 'instrument'],
    [99, 'articulation'],
] as const)('preserves queued peer tier and version %i during an %s write', async (version, edit) => {
    const peer = {
        version,
        data: { instrumentId: 'cello', currentArticulation: 'pizzicato', disclosureTier: 'expert', unrelated: 'newer' },
    };
    const patch = editedPatch(edit);
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch } });
    await requestDuringSnapshotEdit(
        (state) => editDevice(state, (device) => ({ ...device, deviceState: peer })),
        async () => {
            commitLevainDeviceState('a');
            await settleIdentityRequests();
        }
    );
    expect(rawProjectState('a')).toEqual(peer);
    expect(projectState('a')).toEqual(peer);
});

it('keeps an identity request for the same entity when its projection is cloned', async () => {
    const before = structuredClone(projectState('a'));
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
    await requestDuringSnapshotEdit(
        (state) => editDevice(state, (device) => structuredClone(device)),
        async () => {
            commitLevainDeviceState('a');
            await settleIdentityRequests();
        }
    );
    // The clone is the same persisted UUID and state facet, with no new entity generation.
    expect(rawProjectState('a')?.data).toMatchObject({
        ...before?.data,
        instrumentId: 'horn',
        currentArticulation: 'sustain',
    });
});

it('does not carry a queued identity into a successor project retaining identical device objects and bytes', async () => {
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
    await requestAcrossSuccessorProject(async () => {
        commitLevainDeviceState('a');
        await settleIdentityRequests();
    });
});

it('refuses unknown versions before a tier or identity request', async () => {
    const peer = { version: 99, data: { future: 'preserve' } };
    trackStore.set(editDevice(trackStore.value!, (device) => ({ ...device, deviceState: peer })));
    flushAutomergeStorageWrites();
    await setLevainPanelUiLevel('a', 6);
    commitLevainDeviceState('a');
    expect(rawProjectState('a')).toEqual(peer);
    expect(dispatched).toHaveLength(0);
    expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('newer version'), 'warning');
});

it.each(['instrument', 'articulation'])(
    'preserves the authoritative peer tier and unknown metadata during a current %s edit',
    async (edit) => {
        await setLevainPanelUiLevel('a', 6);
        const patch = editedPatch(edit);
        levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch } });
        commitLevainDeviceState('a');
        await settleIdentityRequests();
        const expected = {
            version: 1,
            data: {
                instrumentId: patch.instrumentId,
                currentArticulation: patch.currentArticulation,
                disclosureTier: 'expert',
                unrelated: 'preserve',
            },
        };
        expect(rawProjectState('a')).toEqual(expected);
        expect(projectState('a')).toEqual(expected);
        expect(projectState('b')?.data.instrumentId).toBe('horn');
    }
);

function commitTopology(tracks: TrackStoreState['tracks'], snapshotTransaction: object): void {
    mutateCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>({
        id: 'root',
        snapshotTransaction,
        changeFn: (document) => {
            document.tracks.tracks = JSON.parse(JSON.stringify(tracks));
        },
    });
    projectCrdtToStores();
}

it.each(['tier', 'identity'] as const)(
    'retires an already submitted %s request after committed removal and identical restore',
    async (facet) => {
        const original = structuredClone(rawProjectState('a'));
        if (facet === 'identity') {
            levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
        }
        await requestDuringSnapshotEdit(
            (state, transaction) => {
                const tracks = structuredClone(state.tracks);
                commitTopology(
                    editDevice(state, (device) => device).tracks.map((track) => ({
                        ...track,
                        devices: track.devices.filter((device) => device.id !== 'a'),
                    })),
                    transaction
                );
                expect(rawProjectDevice('a')).toBeUndefined();
                expect(committedMembershipEvents.at(-1)).toBe(false);
                commitTopology(tracks, transaction);
                expect(rawProjectState('a')).toEqual(original);
            },
            async () => {
                if (facet === 'tier') {
                    await setLevainPanelUiLevel('a', 6);
                } else {
                    commitLevainDeviceState('a');
                    await settleIdentityRequests();
                }
            }
        );
        expect(rawProjectState('a')).toEqual(original);
        expect(levainStore.value?.a?.uiLevel).toBe(1);
    }
);

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
        const absent =
            loss === 'owner'
                ? tracks.map((track) => ({ ...track, id: 'different-owner' }))
                : editDevice(state, (device) => ({ ...device, type: 'crust' })).tracks;
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

it.each(['identity', 'tier'] as const)(
    'does not create the old second facet after a held %s commit loses its target',
    async (firstFacet) => {
        let committed!: () => void;
        let release!: () => void;
        const firstCommitted = new Promise<void>((resolve) => {
            committed = resolve;
        });
        const completion = new Promise<void>((resolve) => {
            release = resolve;
        });
        const hold = { committed, release: completion };
        if (firstFacet === 'identity') {
            identityCompletion.hold = hold;
        } else {
            tierCompletion.hold = hold;
        }
        const identity = () => {
            levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
            commitLevainDeviceState('a');
        };
        if (firstFacet === 'identity') {
            identity();
        }
        const tier = setLevainPanelUiLevel('a', 6);
        if (firstFacet === 'tier') {
            identity();
        }
        await firstCommitted;
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
        release();
        await tier;
        await settleIdentityRequests();
        expect(rawProjectState('a')).toEqual(saved);
        expect(submittedFacets).toEqual([firstFacet, 'tier']);
    }
);
