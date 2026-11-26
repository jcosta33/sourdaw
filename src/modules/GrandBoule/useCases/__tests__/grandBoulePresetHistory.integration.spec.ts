import { getHeads, getObjectId } from '@automerge/automerge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerKernelPorts } from '#/app/registerKernelPorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';
import { defaultTrackState, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, undoStore } from '#/modules/Command/stores';
import * as command from '#/modules/Command/useCases';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    compactProject,
    createCrdtDoc,
    getCrdtDoc,
    loadCrdtProject,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultGrandBoulePersistedState, toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, resetGrandBouleStores } from '../../stores/grandBouleStore';
import { loadGrandBoulePreset } from '../loadGrandBoulePreset';

vi.mock('../resolveGrandBouleEngine', async () => {
    const { createDisconnectedGrandBouleEngineHandle } = await import('../../repositories/grandBouleEngineHandle');
    return { resolveGrandBouleEngine: createDisconnectedGrandBouleEngineHandle };
});

registerKernelPorts();

const PROJECT_ID = 'grand-boule-preset-history';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE = {
    id: 'grand-boule',
    type: 'grand-boule',
    name: 'Grand Boule',
    bypassed: false,
    parameterValues: { mic_position: 2 },
};
const NEIGHBOR = {
    id: 'neighbor',
    type: 'grand-boule',
    name: 'Neighbor',
    bypassed: true,
    parameterValues: { mic_position: 1 },
};
const TRACK_ID = 'piano';
const DEFAULT = createDefaultGrandBoulePersistedState();
const WARM_VOICING = { hammerHardness: -0.35, velocityCurve: 1.2, stereoWidth: 0.45, toneTilt: -0.3 };
const WARM = toGrandBouleDeviceState({ ...DEFAULT, parameters: WARM_VOICING });
const EXPLICIT_NEUTRAL = toGrandBouleDeviceState(DEFAULT);
const SPARSE_NON_DEFAULT = {
    version: 1,
    data: {
        modelA: 'balanced-grand',
        modelB: 'clear-grand',
        morphPosition: 0.45,
        layerBalance: 0,
        enabled: true,
        temperament: 3,
        exportMetadata: { channelIds: ['room'] },
    },
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type Root = { tracks: TrackStoreState };
type Chunk = DeviceStateChunkSnapshot;
function pickPreset(presetId: string): void {
    expect(
        loadGrandBoulePreset({
            deviceId: DEVICE.id,
            engine: createDisconnectedGrandBouleEngineHandle(),
            store: createGrandBouleStore(DEVICE.id),
            presetId,
        })
    ).toBe(true);
}

function register(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function seed(before?: Chunk): void {
    const track = createTrack({ id: TRACK_ID, name: 'Piano', kind: 'midi', withoutDefaultDevice: true });
    const other = createTrack({ id: 'other', name: 'Other piano', kind: 'midi', withoutDefaultDevice: true });
    const device = before ? { ...DEVICE, deviceState: before } : DEVICE;
    trackStore.set({ ...defaultTrackState, tracks: [{ ...track, devices: [device, NEIGHBOR] }, other] });
    flushAutomergeStorageWrites();
}

function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Missing Grand Boule project document');
    }
    return document;
}

function track() {
    const raw = root().tracks.tracks[0];
    if (!raw) {
        throw new Error('Expected the raw Grand Boule owner track');
    }
    expect(trackStore.value?.tracks[0]).toEqual(raw);
    return raw;
}

function expectChunk(expected: Chunk | null): void {
    const [device, neighbor] = track().devices;
    if (!device) {
        throw new Error('Expected the raw Grand Boule device');
    }
    expect(Object.hasOwn(device, 'deviceState')).toBe(expected !== null);
    const expectedDevice = expected === null ? DEVICE : { ...DEVICE, deviceState: expected };
    expect(device).toEqual(expectedDevice);
    expect(neighbor).toEqual(NEIGHBOR);
}

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

async function persistAndReopen(): Promise<void> {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    await vi.waitFor(() => {
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        const mirror = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
        expect(mirror.witness).toBe(captureDurableDocumentWitness());
    });
    await compactProject();
    const mirror = sessionStorage.getItem(SESSION_KEY);
    if (mirror === null) {
        throw new Error('Expected the persisted session history');
    }
    await activateProject();
    removeCrdtDoc('root');
    createCrdtDoc('root');
    await expect(loadCrdtProject()).resolves.toBe(true);
    resetGrandBouleStores();
    projectCrdtToStores({ resetProjections: true });
    sessionStorage.setItem(SESSION_KEY, mirror);
    register();
}

describe('Grand Boule preset history through production Command and document storage', () => {
    let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        setNotificationEventBus(createEventBus<NotificationEvents>());
    });
    beforeEach(async () => {
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        await activateProject();
        resetCrdtProjectAuthority(PROJECT_ID);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        await compactProject();
        register();
    });
    afterEach(() => {
        resetGrandBouleStores();
        clearUndoHistory();
        clearHandlerRegistry();
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
    });
    afterAll(async () => {
        await indexedDb.dispose();
    });

    it('keeps Classic a no-op and restores the absent chunk before the previous rename', async () => {
        seed();
        await executeAppAction({ type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Main piano' } });
        const prior = undoStore.value?.past.slice();
        expect(prior).toHaveLength(1);

        pickPreset('grand-boule-classic');
        expectChunk(null);
        expect(undoStore.value?.past).toEqual(prior);

        pickPreset('grand-boule-warm');
        await expect.poll(() => undoStore.value?.past.length).toBe(2);
        expectChunk(WARM);
        await undo();
        expectChunk(null);
        expect(track().name).toBe('Main piano');
        expect(undoStore.value?.past).toEqual(prior);

        await redo();
        expectChunk(WARM);
        expect(track().name).toBe('Main piano');
    });

    it.each([
        { name: 'explicit neutral', before: EXPLICIT_NEUTRAL },
        { name: 'sparse non-default', before: SPARSE_NON_DEFAULT },
    ])('restores the exact $name chunk', async ({ before }) => {
        seed(before);
        pickPreset('grand-boule-warm');
        await expect.poll(() => undoStore.value?.past.length).toBe(1);
        const after = track().devices[0]?.deviceState;
        expect(after?.data).toMatchObject({ ...before.data, ...WARM_VOICING });
        await undo();
        expectChunk(before);
        await redo();
        expect(track().devices[0]?.deviceState).toEqual(after);
    });

    it('reopens the preset entry in both undo and redo stacks', async () => {
        seed();
        pickPreset('grand-boule-warm');
        await expect.poll(() => undoStore.value?.past.length).toBe(1);
        await persistAndReopen();
        expectChunk(WARM);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expectChunk(null);

        await persistAndReopen();
        expectChunk(null);
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expectChunk(WARM);
    });

    it('refuses a queued absent-source edit after a raw neutral chunk arrives before projection', async () => {
        seed();
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const device = document.tracks.tracks[0]?.devices[0];
                if (!device) {
                    throw new Error('Missing Grand Boule peer-write target');
                }
                device.deviceState = EXPLICIT_NEUTRAL;
            },
        });
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
        await expect(
            executeAppActionBatch([
                {
                    type: 'setGrandBouleDeviceState',
                    payload: { trackId: TRACK_ID, deviceId: DEVICE.id, before: null, after: WARM },
                },
            ])
        ).resolves.toMatchObject({ status: 'conflicted' });
        expect(getCrdtDoc<Root>('root')?.tracks.tracks[0]?.devices[0]?.deviceState).toEqual(EXPLICIT_NEUTRAL);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('refuses a preset picked before a peer replaces the piano with an equal device', async () => {
        seed();
        const original = track().devices[0];
        expect(original).toEqual(DEVICE);
        const originalId = getObjectId(original);
        expect(originalId).toBeTruthy();

        const execute = vi.spyOn(command, 'executeAppAction');
        pickPreset('grand-boule-warm');
        const dispatch = execute.mock.results[0]?.value;
        execute.mockRestore();
        expect(dispatch).toBeInstanceOf(Promise);

        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const piano = document.tracks.tracks[0];
                if (!piano) {
                    throw new Error('Missing Grand Boule owner track');
                }
                piano.devices.splice(0, 1, structuredClone(DEVICE));
            },
        });
        const replacement = track().devices[0];
        expect(replacement).toEqual(original);
        const replacementId = getObjectId(replacement);
        expect(replacementId).toBeTruthy();
        expect(replacementId).not.toBe(originalId);
        const peerHeads = getHeads(root());

        const [completion] = await Promise.allSettled([dispatch]);
        expectChunk(null);
        expect(getObjectId(track().devices[0])).toBe(replacementId);
        expect(getHeads(root())).toEqual(peerHeads);
        expect(undoStore.value?.past).toEqual([]);
        expect(createGrandBouleStore(DEVICE.id).value?.parameters).toEqual(DEFAULT.parameters);
        expect(completion.status).toBe('rejected');
    });

    it('refuses Undo when a peer moves the device to another owner', async () => {
        seed();
        pickPreset('grand-boule-warm');
        await expect.poll(() => undoStore.value?.past.length).toBe(1);
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const [piano, other] = document.tracks.tracks;
                if (!piano || !other) {
                    throw new Error('Missing the Grand Boule owner-move targets');
                }
                other.devices.push({ ...DEVICE, deviceState: WARM });
                piano.devices.splice(0, 1);
            },
        });
        projectCrdtToStores({ resetProjections: true });
        await undo();
        expect(track().devices).toEqual([NEIGHBOR]);
        expect(getCrdtDoc<Root>('root')?.tracks.tracks[1]?.devices).toEqual([{ ...DEVICE, deviceState: WARM }]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });
});
