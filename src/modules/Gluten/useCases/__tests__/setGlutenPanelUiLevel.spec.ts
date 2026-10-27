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
import * as commandUseCases from '#/modules/Command/useCases';
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

import type { Device, TrackStoreState } from '#/modules/Arrangement/stores';

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

function duplicateDevice(type: string, version: number): Device {
    return {
        id: 'a',
        name: 'Duplicate device',
        type,
        bypassed: true,
        parameterValues: { mix: 0.75 },
        deviceState: { version, data: { disclosureTier: 'shape', duplicate: 'preserve' } },
    };
}

function withDuplicateDevice(state: TrackStoreState, device: Device, sameTrack: boolean): TrackStoreState {
    const firstTrack = state.tracks[0];
    if (!firstTrack) {
        throw new Error('Missing fixture track');
    }
    let tracks: TrackStoreState['tracks'];
    if (sameTrack) {
        tracks = [{ ...firstTrack, devices: [...firstTrack.devices, device] }, ...state.tracks.slice(1)];
    } else {
        tracks = [...state.tracks, { ...firstTrack, id: 'track-2', devices: [device] }];
    }
    return {
        ...state,
        tracks,
    };
}

async function requestDuringSnapshotEdit(
    edit: (state: TrackStoreState) => TrackStoreState,
    afterCommit?: () => void
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
        try {
            const storageTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
                trackStore.set(edit(trackStore.value!));
            });
            storageTransaction.commit();
            afterCommit?.();
        } finally {
            markEdited();
        }
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
        vi.restoreAllMocks();
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

    it.each([
        { type: 'gluten', version: 1, sameTrack: true },
        { type: 'gluten', version: 1, sameTrack: false },
        { type: 'yeast', version: 1, sameTrack: true },
        { type: 'yeast', version: 99, sameTrack: false },
    ])('does not dispatch for duplicate ids ($type, version $version, same track $sameTrack)', async (fixture) => {
        trackStore.set(
            withDuplicateDevice(trackStore.value!, duplicateDevice(fixture.type, fixture.version), fixture.sameTrack)
        );
        flushAutomergeStorageWrites();
        const before = structuredClone(trackStore.value);
        const rawBefore = Automerge.toJS(getCrdtDoc('root')!);
        const dispatch = vi.spyOn(commandUseCases, 'executeUserAppAction');

        await setGlutenPanelUiLevel('a', 5);

        expect(dispatch).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual(before);
        expect(Automerge.toJS(getCrdtDoc('root')!)).toEqual(rawBefore);
        expect(getGlutenState('a').uiLevel).toBe(1);
    });

    it.each([1, 99])(
        'does not dispatch for a standalone device of another type with state version %i',
        async (version) => {
            const tracks = tracksWithTwoGlutenDevices();
            tracks[0]!.devices[0] = duplicateDevice('yeast', version);
            trackStore.set({ ...defaultTrackState, tracks });
            flushAutomergeStorageWrites();
            const before = structuredClone(trackStore.value);
            const rawBefore = Automerge.toJS(getCrdtDoc('root')!);
            const dispatch = vi.spyOn(commandUseCases, 'executeUserAppAction');

            await setGlutenPanelUiLevel('a', 5);

            expect(dispatch).not.toHaveBeenCalled();
            expect(trackStore.value).toEqual(before);
            expect(Automerge.toJS(getCrdtDoc('root')!)).toEqual(rawBefore);
            expect(getGlutenState('a').uiLevel).toBe(1);
        }
    );

    it.each([
        { type: 'gluten', version: 1, sameTrack: true },
        { type: 'gluten', version: 1, sameTrack: false },
        { type: 'yeast', version: 1, sameTrack: true },
        { type: 'yeast', version: 99, sameTrack: false },
    ])(
        'refuses ids duplicated during snapshot admission ($type, version $version, same track $sameTrack)',
        async (fixture) => {
            let expected!: TrackStoreState;
            const addressedDevice = trackStore.value!.tracks[0]!.devices[0]!;
            await requestDuringSnapshotEdit(
                (state) => {
                    expect(state.tracks[0]?.devices[0]).toBe(addressedDevice);
                    expected = withDuplicateDevice(
                        state,
                        duplicateDevice(fixture.type, fixture.version),
                        fixture.sameTrack
                    );
                    return expected;
                },
                () => {
                    // Retain the unchanged object so only the new duplicate can invalidate admission.
                    trackStore.value!.tracks[0]!.devices[0] = addressedDevice;
                }
            );

            expect(trackStore.value?.tracks[0]?.devices[0]).toBe(addressedDevice);
            expect(trackStore.value).toEqual(expected);
            expect(getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks).toEqual(
                expected.tracks
            );
            expect(getGlutenState('a').uiLevel).toBe(1);
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
        }
    );

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

    it('refuses changed project authority while retaining the captured device object and content', async () => {
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

        const capturedState = trackStore.value!;
        const capturedDevice = capturedState.tracks[0]!.devices[0]!;
        const request = setGlutenPanelUiLevel('a', 4);
        resetCrdtProjectAuthority('Successor Gluten project');
        trackStore.set(capturedState);
        flushAutomergeStorageWrites();
        // Preserve the original object and content to isolate the authority fence.
        trackStore.value!.tracks[0]!.devices[0] = capturedDevice;
        releaseTransaction();
        await transaction;
        await request;

        expect(trackStore.value?.tracks[0]?.devices[0]).toBe(capturedDevice);
        expect(rawProjectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(projectState('a')).toEqual(rawProjectState('a'));
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('changed'), 'warning');
    });
});
