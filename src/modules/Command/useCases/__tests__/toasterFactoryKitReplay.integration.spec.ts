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
import { getToasterPresetDeviceState } from '#/modules/Toaster/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getExecutableCommandRegistrations } from '../getExecutableCommandRegistrations';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';

registerKernelPorts();

const PROJECT_ID = 'toaster-factory-kit-replay';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE = {
    id: 'toaster',
    type: 'toaster',
    name: 'Toaster',
    bypassed: false,
    parameterValues: { master_gain: 0.41 },
};
const NEIGHBOR = {
    id: 'neighbor',
    type: 'toaster',
    name: 'Neighbor',
    bypassed: true,
    parameterValues: { master_gain: 0.63 },
};
const TRACK_ID = 'drums';
const GROUP_ID = 'kit-replacement';
const UNOWNED = { exportMetadata: { channelIds: ['kick-out', 'snare-out'] } };

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type Root = { tracks: TrackStoreState };
type Chunk = DeviceStateChunkSnapshot;
type KitAction = Extract<AppAction, { type: 'setToasterFactoryKit' }>;
type MasterAction = Extract<AppAction, { type: 'setToasterMasterGain' }>;

function kit(id: string, siblings: Chunk['data'] = {}): Chunk {
    const chunk = getToasterPresetDeviceState(id);
    if (!chunk) {
        throw new Error(`Missing Toaster factory kit ${id}`);
    }
    return { ...chunk, data: { ...siblings, ...chunk.data } };
}

function selection(before: Chunk | null, after: Chunk, label = 'Load Rye 909'): KitAction {
    return {
        type: 'setToasterFactoryKit',
        payload: { trackId: TRACK_ID, deviceId: DEVICE.id, deviceIds: [DEVICE.id, NEIGHBOR.id], before, after, label },
    };
}

function masterGain(before: MasterAction['payload']['before'], value: number): MasterAction {
    return {
        type: 'setToasterMasterGain',
        payload: {
            trackId: TRACK_ID,
            deviceId: DEVICE.id,
            deviceIds: [DEVICE.id, NEIGHBOR.id],
            before,
            after: { kind: 'value', value },
        },
    };
}

function register(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function seed({
    before,
    frozen = false,
    wrongType = false,
    duplicate = false,
}: { before?: Chunk; frozen?: boolean; wrongType?: boolean; duplicate?: boolean } = {}): void {
    const track = createTrack({ id: TRACK_ID, name: 'Rhythm', kind: 'midi', withoutDefaultDevice: true });
    const other = createTrack({ id: 'other', name: 'Other', kind: 'midi', withoutDefaultDevice: true });
    const device = { ...DEVICE, type: wrongType ? 'fermenter' : DEVICE.type };
    const seededDevice = before ? { ...device, deviceState: before } : device;
    trackStore.set({
        ...defaultTrackState,
        tracks: [
            { ...track, frozen, devices: [seededDevice, NEIGHBOR] },
            { ...other, devices: duplicate ? [DEVICE] : [] },
        ],
    });
    flushAutomergeStorageWrites();
}

function track() {
    const raw = getCrdtDoc<Root>('root')?.tracks.tracks[0];
    if (!raw) {
        throw new Error('Expected the raw Toaster owner track');
    }
    expect(trackStore.value?.tracks[0]).toEqual(raw);
    return raw;
}

function expectChunk(expected: Chunk | null): void {
    const [device, neighbor] = track().devices;
    if (!device) {
        throw new Error('Expected the raw Toaster device');
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
    projectCrdtToStores({ resetProjections: true });
    sessionStorage.setItem(SESSION_KEY, mirror);
    register();
}

describe('Toaster factory kit history through production Command and document storage', () => {
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
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
    });
    afterAll(async () => {
        await indexedDb.dispose();
    });

    it('persists one local-only entry and replays exact chunk absence after reopening both stacks', async () => {
        seed();
        const after = kit('909-punchy');
        const action = selection(null, after);
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        expect(getExecutableCommandRegistrations().map(({ actionType }) => actionType)).not.toContain(action.type);
        await expect(
            executeAppActionBatch([action], { groupId: GROUP_ID, groupLabel: action.payload.label })
        ).resolves.toMatchObject({ status: 'committed' });
        expectChunk(after);
        expect(macroStore.value?.currentRecording).toEqual([]);
        expect(undoStore.value?.past).toMatchObject([
            {
                label: action.payload.label,
                groupId: GROUP_ID,
                action,
                inverseAction: { payload: { before: after, after: null } },
                redoAction: action,
            },
        ]);

        await persistAndReopen();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expectChunk(null);
        expect(undoStore.value?.future).toHaveLength(1);

        await persistAndReopen();
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expectChunk(after);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('replays a real rename and two kit actions as one mixed group through their staged prefixes', async () => {
        const before = { version: 1, data: UNOWNED };
        seed({ before });
        const first = kit('909-punchy', UNOWNED);
        const second = kit('trap-heavy', UNOWNED);
        const rename = { type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Main drums' } } satisfies AppAction;
        await expect(
            executeAppActionBatch([rename, selection(before, first), selection(first, second, 'Load Trap Dough')], {
                groupId: GROUP_ID,
            })
        ).resolves.toMatchObject({ status: 'committed' });
        expect(track().name).toBe('Main drums');
        expectChunk(second);
        expect(undoStore.value?.past).toMatchObject([
            { groupId: GROUP_ID, action: rename },
            { groupId: GROUP_ID, inverseAction: { payload: { before: first, after: before } } },
            { groupId: GROUP_ID, inverseAction: { payload: { before: second, after: first } } },
        ]);

        await undo();
        expect(track().name).toBe('Rhythm');
        expectChunk(before);
        expect(undoStore.value?.future).toHaveLength(3);

        await redo();
        expect(track().name).toBe('Main drums');
        expectChunk(second);
        expect(undoStore.value?.past).toHaveLength(3);
    });

    it('rejects a prior real generic mirror before the mixed batch can write', async () => {
        seed();
        const before = kit('909-punchy');
        const after = kit('trap-heavy');
        const mirror: AppAction = { type: 'setDeviceState', payload: { deviceId: DEVICE.id, state: before } };
        await expect(executeAppActionBatch([mirror, selection(before, after)])).resolves.toEqual({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: setDeviceState',
            actions: [],
        });
        expectChunk(null);
        expect(undoStore.value?.past).toEqual([]);
        await executeAppAction(mirror);
        expectChunk(before);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        ['a frozen owner', { frozen: true }],
        ['a wrong device type', { wrongType: true }],
        ['a duplicate ID', { duplicate: true }],
    ] as const)('conflicts with %s before any mixed-batch member writes', async (_name, options) => {
        seed(options);
        const original = structuredClone(track());
        await expect(
            executeAppActionBatch([
                { type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Changed' } },
                selection(null, kit('909-punchy')),
            ])
        ).resolves.toMatchObject({ status: 'conflicted', actions: [] });
        expect(track()).toEqual(original);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects a corrupt owned kit, unknown envelope version, or changed unowned data', async () => {
        const malformed = { version: 1, data: { ...UNOWNED, kit: { name: 'Incomplete' } } };
        seed({ before: malformed });
        await expect(executeAppActionBatch([selection(malformed, kit('909-punchy', UNOWNED))])).resolves.toMatchObject({
            status: 'conflicted',
        });
        expectChunk(malformed);

        const unsupported = { ...kit('trap-heavy', UNOWNED), version: 2 };
        await executeAppAction({ type: 'setDeviceState', payload: { deviceId: DEVICE.id, state: unsupported } });
        await expect(
            executeAppActionBatch([selection(unsupported, kit('909-punchy', UNOWNED))])
        ).resolves.toMatchObject({ status: 'conflicted' });
        expectChunk(unsupported);

        const before = kit('trap-heavy', UNOWNED);
        await executeAppAction({ type: 'setDeviceState', payload: { deviceId: DEVICE.id, state: before } });
        await expect(executeAppActionBatch([selection(before, kit('909-punchy'))])).resolves.toMatchObject({
            status: 'conflicted',
        });
        expectChunk(before);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('does not overwrite a newer raw kit before the track projection observes it', async () => {
        seed();
        const peer = kit('trap-heavy');
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const device = document.tracks.tracks[0]?.devices[0];
                if (!device) {
                    throw new Error('Expected the Toaster before the raw kit write');
                }
                device.deviceState = peer;
            },
        });
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
        const result = await executeAppActionBatch([selection(null, kit('909-punchy'))]);
        expect(result.status).toBe('conflicted');
        expect(getCrdtDoc<Root>('root')?.tracks.tracks[0]?.devices[0]?.deviceState).toEqual(peer);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('refuses replay after the owned kit changes and preserves its history entry', async () => {
        seed();
        const after = kit('909-punchy');
        await expect(executeAppActionBatch([selection(null, after)], { groupId: GROUP_ID })).resolves.toMatchObject({
            status: 'committed',
        });
        const peer = kit('trap-heavy');
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const device = document.tracks.tracks[0]?.devices[0];
                if (!device) {
                    throw new Error('Expected the Toaster before the peer write');
                }
                device.deviceState = peer;
            },
        });
        projectCrdtToStores({ resetProjections: true });
        expectChunk(peer);

        await undo();
        expectChunk(peer);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('restores an absent Master chunk and replays a committed zero after opening both session stacks', async () => {
        seed();
        const action = masterGain({ kind: 'missing-chunk' }, 0);
        const after = { version: 1, data: { kit: { masterGain: 0 } } };
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        await executeAppAction(action);
        expectChunk(after);
        expect(undoStore.value?.past).toMatchObject([
            {
                label: 'Set Toaster Master gain',
                action,
                inverseAction: {
                    type: action.type,
                    payload: { before: action.payload.after, after: action.payload.before },
                },
                redoAction: action,
            },
        ]);
        expect(macroStore.value?.currentRecording).toEqual([]);

        await persistAndReopen();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expectChunk(null);
        expect(undoStore.value?.future).toHaveLength(1);

        await persistAndReopen();
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expectChunk(after);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });

    it.each([
        [{ version: 1, data: UNOWNED }, { kind: 'missing-kit' }, {}],
        [{ version: 1, data: { ...UNOWNED, kit: {} } }, { kind: 'missing-gain' }, {}],
        [
            { version: 1, data: { ...UNOWNED, kit: { masterGain: 0, swing: 0.3 } } },
            { kind: 'value', value: 0 },
            { swing: 0.3 },
        ],
    ] as const)('restores the exact earlier Master shape from %j', async (before, capture, siblings) => {
        seed({ before });
        const after = { version: 1, data: { ...UNOWNED, kit: { ...siblings, masterGain: 1.2 } } };
        await expect(
            executeAppActionBatch([masterGain(capture, 1.2)], { groupId: 'master-gain' })
        ).resolves.toMatchObject({
            status: 'committed',
        });
        expectChunk(after);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expectChunk(before);
        await redo();
        expectChunk(after);
    });

    it('keeps a peer pad and data fields added under the ancestors the Master edit created', async () => {
        seed();
        const action = masterGain({ kind: 'missing-chunk' }, 0.3);
        await executeAppAction(action);
        const pads = [{ id: 'peer-kick', volume: 0.42 }];
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                const data = document.tracks.tracks[0]?.devices[0]?.deviceState?.data;
                const peerKit = data?.kit;
                if (!data || !isRecord(peerKit)) {
                    throw new Error('Expected Master to create a kit before the peer write');
                }
                peerKit.pads = pads;
                data.exportMetadata = UNOWNED.exportMetadata;
            },
        });
        projectCrdtToStores({ resetProjections: true });
        expectChunk({ version: 1, data: { ...UNOWNED, kit: { pads, masterGain: 0.3 } } });

        await undo();
        expectChunk({ version: 1, data: { ...UNOWNED, kit: { pads } } });
        await redo();
        expectChunk({ version: 1, data: { ...UNOWNED, kit: { pads, masterGain: 0.3 } } });
    });

    it('refuses a mixed Master batch before the earlier rename can write', async () => {
        seed();
        const action = masterGain({ kind: 'missing-chunk' }, 0);
        await expect(
            executeAppActionBatch([
                { type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Should not land' } },
                action,
            ])
        ).resolves.toEqual({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: setToasterMasterGain',
            actions: [],
        });
        expect(track().name).toBe('Rhythm');
        expectChunk(null);
        expect(undoStore.value?.past).toEqual([]);
    });
});
