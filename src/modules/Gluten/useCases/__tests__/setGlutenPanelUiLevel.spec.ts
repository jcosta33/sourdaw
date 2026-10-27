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

import { getGlutenState, glutenStore, setGlutenUiLevel } from '../../stores/glutenStore';
import { hydrateGlutenDisclosureFromProject } from '../hydrateGlutenDisclosureFromProject';
import { setGlutenPanelUiLevel } from '../setGlutenPanelUiLevel';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

function tracksWithTwoGlutenDevices() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'a',
                        name: 'Gluten A',
                        type: 'gluten',
                        bypassed: false,
                        parameterValues: { ratio: 3, mix: 0.42 },
                        deviceState: { version: 1, data: { unrelated: 'preserve' } },
                    },
                    { id: 'b', name: 'Gluten B', type: 'gluten', bypassed: false, parameterValues: {} },
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

async function requestDuringSnapshotEdit(edit: (state: TrackStoreState) => TrackStoreState): Promise<void> {
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
    const request = setGlutenPanelUiLevel('a', 5);
    allowEdit();
    await edited;
    releaseTransaction();
    await transaction;
    await request;
}

describe('setGlutenPanelUiLevel project path', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Gluten disclosure integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        agentProjectRepairStateStore.set(null);
        vi.mocked(notifyUser).mockClear();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        glutenStore.set({});
        setGlutenUiLevel('a', 1);
        setGlutenUiLevel('b', 1);
        trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoGlutenDevices() });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
    });

    it('restores distinct addressed tiers from saved Automerge binary bytes after session loss', async () => {
        await setGlutenPanelUiLevel('a', 5);
        await setGlutenPanelUiLevel('b', 2);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve', disclosureTier: 'lab' } });
        expect(projectState('b')).toEqual({ version: 1, data: { disclosureTier: 'shape' } });
        expect(getGlutenState('a').uiLevel).toBe(1);

        const source = getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root');
        if (!source) {
            throw new Error('Missing project document');
        }
        const bytes = Automerge.save(source);
        const loaded = Automerge.load<{ tracks: Pick<TrackStoreState, 'tracks'> }>(bytes);
        const projected = sanitizeTrackSnapshot(Automerge.toJS(loaded).tracks);
        resetCrdtProjectAuthority('Binary-restored Gluten project');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        flushAutomergeStorageWrites();
        glutenStore.set({});
        setGlutenUiLevel('a', 1);
        setGlutenUiLevel('b', 1);
        hydrateGlutenDisclosureFromProject('a');
        hydrateGlutenDisclosureFromProject('b');
        expect(getGlutenState('a').uiLevel).toBe(5);
        expect(getGlutenState('b').uiLevel).toBe(2);
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({ ratio: 3, mix: 0.42 });
    });

    it('hydrates disclosure without replacing the live patch', async () => {
        const engine = getGlutenState('a').patch;
        await setGlutenPanelUiLevel('a', 4);
        hydrateGlutenDisclosureFromProject('a');
        expect(getGlutenState('a').uiLevel).toBe(4);
        expect(getGlutenState('a').patch).toBe(engine);
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

        const shape = setGlutenPanelUiLevel('a', 2);
        const route = setGlutenPanelUiLevel('a', 4);
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
        glutenStore.set({});
        setGlutenUiLevel('a', 1);
        setGlutenUiLevel('b', 1);
        hydrateGlutenDisclosureFromProject('a');
        expect(getGlutenState('a').uiLevel).toBe(4);
    });

    it('refuses an unknown state version without replacing or disclosing a choice', async () => {
        const tracks = tracksWithTwoGlutenDevices();
        const device = tracks[0]?.devices[0];
        if (!device) {
            throw new Error('Missing fixture device');
        }
        device.deviceState = { version: 99, data: { disclosureTier: 'lab', future: 'value' } };
        trackStore.set({ ...defaultTrackState, tracks });

        await setGlutenPanelUiLevel('a', 4);
        expect(projectState('a')).toEqual({ version: 99, data: { disclosureTier: 'lab', future: 'value' } });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('newer version'), 'warning');
        hydrateGlutenDisclosureFromProject('a');
        expect(getGlutenState('a').uiLevel).toBe(1);
    });

    it('does not create state for a missing device', async () => {
        await setGlutenPanelUiLevel('missing', 5);
        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
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
        await setGlutenPanelUiLevel('a', 5);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(getGlutenState('a').uiLevel).toBe(1);
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
        expect(getGlutenState('a').uiLevel).toBe(1);
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
        expect(getGlutenState('a').uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });

    it('does not address a replacement device that reuses the captured id', async () => {
        const replacement = { version: 1, data: { unrelated: 'preserve' } };
        await requestDuringSnapshotEdit((state) => ({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) =>
                    device.id === 'a' ? { ...device, name: 'Replacement Gluten', deviceState: replacement } : device
                ),
            })),
        }));

        expect(rawProjectState('a')).toEqual(replacement);
        expect(projectState('a')).toEqual(replacement);
        expect(trackStore.value?.tracks[0]?.devices[0]?.name).toBe('Replacement Gluten');
        expect(getGlutenState('a').uiLevel).toBe(1);
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

        const request = setGlutenPanelUiLevel('a', 4);
        resetCrdtProjectAuthority('Successor Gluten project');
        trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoGlutenDevices() });
        flushAutomergeStorageWrites();
        releaseTransaction();
        await transaction;
        await request;

        expect(rawProjectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(projectState('a')).toEqual(rawProjectState('a'));
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });
});
