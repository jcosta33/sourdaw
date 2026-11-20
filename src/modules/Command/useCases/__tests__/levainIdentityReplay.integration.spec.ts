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
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry, getHandlerByType } from '../../stores/handlerRegistry';
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

const PROJECT_ID = 'levain-identity-replay';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE = {
    id: 'levain',
    type: 'levain',
    name: 'Levain',
    bypassed: false,
    parameterValues: { master_gain: 0.41 },
};
const NEIGHBOR = {
    id: 'neighbor',
    type: 'levain',
    name: 'Neighbor',
    bypassed: true,
    parameterValues: { master_gain: 0.63 },
};
const TRACK_ID = 'strings';
const GROUP_ID = 'identity-replacement';
const MISSING_DEVICE_STATE: Chunk = { version: 1, data: { instrumentId: 'violin-1' } };

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type Root = { tracks: TrackStoreState };
type Chunk = DeviceStateChunkSnapshot;
type IdentityAction = Extract<AppAction, { type: 'setLevainIdentity' }>;

function articulation(currentArticulation: string): Chunk {
    return { ...MISSING_DEVICE_STATE, data: { ...MISSING_DEVICE_STATE.data, currentArticulation } };
}

function expert(chunk: Chunk): Chunk {
    return { ...chunk, data: { ...chunk.data, disclosureTier: 'expert' } };
}

function selection(before: Chunk | null, after: Chunk, label: string): IdentityAction {
    return {
        type: 'setLevainIdentity',
        payload: {
            kind: 'articulation',
            trackId: TRACK_ID,
            deviceId: DEVICE.id,
            deviceIds: [DEVICE.id, NEIGHBOR.id],
            label,
            missingDeviceState: MISSING_DEVICE_STATE,
            before: { deviceState: before, parameterValues: {} },
            after: { deviceState: after, parameterValues: {} },
        },
    };
}

function register(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function seed(): void {
    const track = createTrack({ id: TRACK_ID, name: 'Strings', kind: 'midi', withoutDefaultDevice: true });
    trackStore.set({
        ...defaultTrackState,
        tracks: [{ ...track, devices: [DEVICE, NEIGHBOR] }],
    });
    flushAutomergeStorageWrites();
}

function track() {
    const raw = getCrdtDoc<Root>('root')?.tracks.tracks[0];
    if (!raw) {
        throw new Error('Expected the raw Levain owner track');
    }
    expect(trackStore.value?.tracks[0]).toEqual(raw);
    return raw;
}

function expectChunk(expected: Chunk | null): void {
    const [device, neighbor] = track().devices;
    if (!device) {
        throw new Error('Expected the raw Levain device');
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
    const witness = captureDurableDocumentWitness();
    await vi.waitFor(() => {
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        const mirror = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
        expect(mirror.witness).toBe(witness);
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
    expect(captureDurableDocumentWitness()).toBe(witness);
    projectCrdtToStores({ resetProjections: true });
    sessionStorage.setItem(SESSION_KEY, mirror);
    register();
}

describe('Levain identity history through production Command and document storage', () => {
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

    it('restores the local action and its inverse across durable past and future stack reloads', async () => {
        seed();
        const after = articulation('staccato');
        const action = selection(null, after, 'Select Staccato articulation');
        const inverse: IdentityAction = {
            type: 'setLevainIdentity',
            payload: {
                ...action.payload,
                before: action.payload.after,
                after: action.payload.before,
                restore: true,
            },
        };
        const entry = { label: action.payload.label, action, inverseAction: inverse, redoAction: action };

        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        expect(getExecutableCommandRegistrations().map(({ actionType }) => actionType)).not.toContain(action.type);
        await expect(executeAppActionBatch([action])).resolves.toMatchObject({ status: 'committed' });
        expectChunk(after);
        expect(macroStore.value?.currentRecording).toEqual([]);
        expect(undoStore.value?.past).toMatchObject([entry]);

        await persistAndReopen();
        expect(undoStore.value?.past).toMatchObject([entry]);
        expect(undoStore.value?.future).toEqual([]);
        await undo();
        expectChunk(null);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toMatchObject([entry]);

        await persistAndReopen();
        expect(undoStore.value?.future).toMatchObject([entry]);
        await redo();
        expectChunk(after);
        expect(undoStore.value?.past).toMatchObject([entry]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('refuses invalid captured arguments through the registered session validator', () => {
        const validate = getHandlerByType('setLevainIdentity')?.validateSessionActionArguments;
        if (!validate) {
            throw new Error('Expected the registered Levain session validator');
        }
        const staccato = articulation('staccato');
        const payload = selection(articulation('sustain'), staccato, 'Select Staccato').payload;
        const after = payload.after;
        expect(validate(payload)).toBe(true);
        const invalid = {
            'fallback witness with an authored articulation': {
                ...payload,
                missingDeviceState: articulation('sustain'),
            },
            'future chunk version': { ...payload, after: { ...after, deviceState: { ...staccato, version: 2 } } },
            'unknown articulation': {
                ...payload,
                after: { ...after, deviceState: articulation('unknown-articulation') },
            },
            'extra owned parameter key': { ...payload, after: { ...after, parameterValues: { masterGain: 0.41 } } },
            'changed unowned metadata': {
                ...payload,
                after: { ...after, deviceState: { ...staccato, data: { ...staccato.data, peerLabel: 'new' } } },
            },
            'duplicate device in the captured chain': { ...payload, deviceIds: [DEVICE.id, DEVICE.id] },
            'noncanonical restore marker': { ...payload, restore: false },
        };
        for (const [name, candidate] of Object.entries(invalid)) {
            expect(validate(candidate), name).toBe(false);
        }
    });

    it('refuses stale chain captures and a later removal before either batch writes', async () => {
        seed();
        await executeAppAction({ type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Recorded baseline' } });
        const history = undoStore.value;
        expect(history?.past).toHaveLength(1);
        const original = structuredClone(track());
        const action = selection(null, articulation('staccato'), 'Select Staccato');
        const stale: IdentityAction = {
            ...action,
            payload: { ...action.payload, deviceIds: [NEIGHBOR.id, DEVICE.id] },
        };
        const rename = {
            type: 'renameTrack',
            payload: { trackId: TRACK_ID, name: 'Refused rename' },
        } satisfies AppAction;
        const remove = { type: 'removeDevice', payload: { deviceId: DEVICE.id } } satisfies AppAction;
        const canReapply = getHandlerByType(action.type)?.canReapplyAfterDivergence;
        expect(canReapply?.(action)).toBe(true);
        expect(canReapply?.(stale)).toBe(false);
        expect(canReapply?.(action, { actions: [action, remove], actionIndex: 0 })).toBe(false);

        for (const actions of [
            [rename, stale],
            [action, remove],
        ]) {
            await expect(executeAppActionBatch(actions)).resolves.toEqual({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: setLevainIdentity',
                actions: [],
            });
            expectChunk(null);
            expect(track()).toEqual(original);
            expect(undoStore.value).toEqual(history);
        }
    });

    it('preserves a later disclosure edit through a mixed rename and two-action identity group', async () => {
        seed();
        const first = articulation('staccato');
        const second = articulation('legato');
        const rename = { type: 'renameTrack', payload: { trackId: TRACK_ID, name: 'Solo violin' } } satisfies AppAction;

        await expect(
            executeAppActionBatch(
                [
                    rename,
                    selection(null, first, 'Select Staccato articulation'),
                    selection(first, second, 'Select Legato articulation'),
                ],
                { groupId: GROUP_ID }
            )
        ).resolves.toMatchObject({ status: 'committed' });
        expect(track().name).toBe('Solo violin');
        expectChunk(second);

        // The disclosure control uses this nonundoable command and changes only the tier.
        await executeAppAction({ type: 'setDeviceState', payload: { deviceId: DEVICE.id, state: expert(second) } });
        expectChunk(expert(second));
        expect(undoStore.value?.past.map(({ groupId }) => groupId)).toEqual([GROUP_ID, GROUP_ID, GROUP_ID]);

        await undo();
        expect(track().name).toBe('Strings');
        expectChunk(expert(MISSING_DEVICE_STATE));
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(3);

        await redo();
        expect(track().name).toBe('Solo violin');
        expectChunk(expert(second));
        expect(undoStore.value?.past.map(({ groupId }) => groupId)).toEqual([GROUP_ID, GROUP_ID, GROUP_ID]);
        expect(undoStore.value?.future).toEqual([]);
    });
});
