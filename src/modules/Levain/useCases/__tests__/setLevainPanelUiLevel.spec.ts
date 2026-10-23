import { load, save } from '@automerge/automerge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
    replaceCrdtDoc,
    projectCrdtToStores,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { createDefaultPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { commitLevainDeviceState } from '../commitLevainDeviceState';
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

function rawProjectState(deviceId: string) {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')
        ?.tracks.tracks.flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.deviceState;
}

async function requestDuringSnapshotEdit(
    edit: (state: TrackStoreState) => TrackStoreState,
    requestAction = () => setLevainPanelUiLevel('a', 6)
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
    const request = requestAction();
    allowEdit();
    await edited;
    releaseTransaction();
    await transaction;
    await request;
}

const dispatched = vi.hoisted(() => [] as Promise<void>[]);
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeAppAction: (...args: Parameters<typeof original.executeAppAction>) => {
            const request = original.executeAppAction(...args);
            dispatched.push(request);
            return request;
        },
    };
});

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

beforeEach(() => {
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
    trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoLevainDevices() });
    flushAutomergeStorageWrites();
    levainStore.set({ a: hydrateLevainStateFromProject('a')!, b: hydrateLevainStateFromProject('b')! });
});

afterEach(async () => {
    await Promise.all(dispatched);
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

it.each([1, 99])('preserves queued peer identity and metadata in version %i during a tier write', async (version) => {
    const peer = { version, data: { instrumentId: 'flute', currentArticulation: 'staccato', unrelated: 'newer' } };
    await requestDuringSnapshotEdit((state) => editDevice(state, (device) => ({ ...device, deviceState: peer })));
    expect(rawProjectState('a')).toEqual(peer);
    expect(projectState('a')).toEqual(peer);
    expect(levainStore.value?.a?.uiLevel).toBe(1);
});

it('does not address a same-ID, byte-identical replacement after a snapshot wait', async () => {
    const before = structuredClone(projectState('a'));
    await requestDuringSnapshotEdit((state) => editDevice(state, (device) => structuredClone(device)));
    expect(rawProjectState('a')).toEqual(before);
    expect(projectState('a')).toEqual(before);
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
            await Promise.all(dispatched);
        }
    );
    expect(rawProjectState('a')).toEqual(peer);
    expect(projectState('a')).toEqual(peer);
});

it('does not write an identity onto a same-ID replacement after a snapshot wait', async () => {
    const before = structuredClone(projectState('a'));
    levainStore.set({ ...levainStore.value, a: { ...defaultLevainState, patch: createDefaultPatch('horn') } });
    await requestDuringSnapshotEdit(
        (state) => editDevice(state, (device) => structuredClone(device)),
        async () => {
            commitLevainDeviceState('a');
            await Promise.all(dispatched);
        }
    );
    expect(rawProjectState('a')).toEqual(before);
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
        await Promise.all(dispatched);
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
