import { toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { takeLaneStore, trackStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { addTake, addTakeLane, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    getCrdtDoc,
    getCrdtDocIds,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getSettledProjectId } from '#/modules/Project/stores';
import { newProject, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { readSecondsAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { addTempoChange } from '#/modules/Transport/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultState, type ProjectVersion } from '../../../models/ProjectVersion';
import { versionControlStore } from '../../../stores/versionControlStore';
import { getVersionControlHandlers } from '../../getVersionControlHandlers';

const runtimeIo = vi.hoisted(() => ({
    clearRuntimeCachedAudioBuffers: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
    importCachedAudioBuffers: vi.fn(() => Promise.resolve({ persist: () => Promise.resolve(true), publish: () => 0 })),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: () => undefined, publish: () => 0 })),
    resetAudioGraph: vi.fn(),
    setMasterGainValue: vi.fn(),
    startCrdtAutoSave: vi.fn(() => () => undefined),
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        clearRuntimeCachedAudioBuffers: runtimeIo.clearRuntimeCachedAudioBuffers,
        importCachedAudioBuffers: runtimeIo.importCachedAudioBuffers,
        prepareCachedAudioBuffersFromIdb: runtimeIo.prepareCachedAudioBuffersFromIdb,
        resetAudioGraph: runtimeIo.resetAudioGraph,
        setMasterGainValue: runtimeIo.setMasterGainValue,
    };
});

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...actual,
        compactProject: runtimeIo.compactProject,
        startCrdtAutoSave: runtimeIo.startCrdtAutoSave,
    };
});

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return { ...actual, unloadPlugin: runtimeIo.unloadPlugin };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        ensureTrackStrips: vi.fn(),
        stopPlayback: vi.fn(() => Promise.resolve()),
    };
});

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const TRACK_ID = 'track-comp';
const CLIP_ID = 'clip-comp';
const FOREIGN_OWNER_PROJECT_ID = 'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb';
const actionOptions = { skipMacroRecording: true, skipUndo: true } as const;

let notifications: NotifyPayload[] = [];
let notificationBus = createEventBus<NotificationEvents>();
let unsubscribeNotifications: () => void = () => undefined;

async function activateProject(name: string): Promise<string> {
    expect(await newProject(name)).toBe(true);
    flushAutomergeStorageWrites();
    const projectId = getSettledProjectId();
    if (!projectId) {
        throw new Error(`expected ${name} to publish a settled project identity`);
    }
    return projectId;
}

function currentLane() {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === TRACK_ID);
    if (!lane) {
        throw new Error('expected the take lane for the fixture track');
    }
    return lane;
}

/**
 * Seed through the routes production uses: the track and clip through Command
 * actions, the lane and its takes through the comping use cases (no Command
 * action creates lanes or takes), and the selection plus comp region through
 * Command actions. The tempo map starts empty and the transport sits at its
 * default 120 BPM.
 */
async function seedTimelineFixture(): Promise<{ takeAId: string; takeBId: string }> {
    await executeAppAction(
        {
            type: 'addTrack',
            payload: { id: TRACK_ID, name: 'Lead', kind: 'audio', withoutDefaultDevice: true },
        },
        actionOptions
    );
    await executeAppAction(
        {
            type: 'addClip',
            payload: { id: CLIP_ID, trackId: TRACK_ID, name: 'Comp clip', startBeat: 0, endBeat: 8, type: 'audio' },
        },
        actionOptions
    );
    addTakeLane(TRACK_ID);
    addTake(TRACK_ID, CLIP_ID, 'Take A', 0, 8);
    addTake(TRACK_ID, CLIP_ID, 'Take B', 0, 8);
    const [takeA, takeB] = currentLane().takes;
    if (!takeA || !takeB) {
        throw new Error('expected two takes on the fixture lane');
    }
    await executeAppAction({ type: 'selectTake', payload: { trackId: TRACK_ID, takeId: takeA.id } }, actionOptions);
    await executeAppAction(
        {
            type: 'setCompRegion',
            payload: { trackId: TRACK_ID, startBeat: 0, endBeat: 8, takeId: takeA.id },
        },
        actionOptions
    );
    flushAutomergeStorageWrites();
    return { takeAId: takeA.id, takeBId: takeB.id };
}

async function createCheckpoint(label: string): Promise<string> {
    await executeAppAction({ type: 'createProjectVersion', payload: { label } }, actionOptions);
    const versionId = versionControlStore.value?.currentVersionId;
    if (!versionId) {
        throw new Error(`expected checkpoint ${label} to be created`);
    }
    return versionId;
}

function readRawTimelineSlots(): { takeLanes: unknown; tempoMap: unknown } {
    flushAutomergeStorageWrites();
    for (const docId of getCrdtDocIds().toSorted()) {
        const document = getCrdtDoc<Record<string, unknown>>(docId);
        if (!document) {
            throw new Error(`expected CRDT document ${docId} to exist`);
        }
        if ('tempoMap' in document && 'takeLanes' in document) {
            const content = structuredClone(toJS(document));
            return { tempoMap: content.tempoMap, takeLanes: content.takeLanes };
        }
    }
    throw new Error('expected a CRDT document carrying the tempoMap and takeLanes slots');
}

function capturedTimelineState() {
    return {
        raw: readRawTimelineSlots(),
        takeLanes: structuredClone(takeLaneStore.value),
        tempoMap: structuredClone(tempoMapStore.value),
    };
}

async function dispatchRestore(versionId: string): Promise<{
    committed: ReturnType<typeof vi.fn>;
    rejectionName: string | undefined;
}> {
    const committed = vi.fn();
    let rejectionName: string | undefined;
    try {
        await executeAppAction(
            { type: 'restoreProjectVersion', payload: { versionId } },
            { onCommitted: committed, skipMacroRecording: true, skipUndo: true }
        );
    } catch (error) {
        rejectionName = error instanceof Error ? error.name : String(error);
    }
    await notificationBus.waitForIdle();
    return { committed, rejectionName };
}

function stripTimelineSlotsFromVersion(versionId: string): void {
    const catalog = versionControlStore.value;
    if (!catalog) {
        throw new Error('expected a live version-control catalog');
    }
    versionControlStore.set({
        ...catalog,
        versions: catalog.versions.map((version) => {
            if (version.id !== versionId) {
                return version;
            }
            // A payload written before #5108 carries no tempoMap or takeLanes.
            const payload = JSON.parse(version.snapshot.data) as Record<string, unknown>;
            delete payload.tempoMap;
            delete payload.takeLanes;
            const data = JSON.stringify(payload);
            return {
                ...version,
                snapshot: { ...version.snapshot, data, size: new TextEncoder().encode(data).byteLength },
            };
        }),
    });
}

async function selectTakeAndComp(takeId: string): Promise<void> {
    await executeAppAction({ type: 'selectTake', payload: { trackId: TRACK_ID, takeId } }, actionOptions);
    await executeAppAction(
        { type: 'setCompRegion', payload: { trackId: TRACK_ID, startBeat: 0, endBeat: 8, takeId } },
        actionOptions
    );
    flushAutomergeStorageWrites();
}

describe('legacy version timeline snapshot round trip', () => {
    beforeEach(() => {
        // jsdom ships no Web Locks API, and the durable reset the project
        // bootstrap performs sequences on it.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        Container.clear();
        configureAutomergeStoragePort(null);
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getVersionControlHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        localStorage.clear();
        versionControlStore.set(createDefaultState());
        notifications = [];
        notificationBus = createEventBus<NotificationEvents>();
        unsubscribeNotifications = notificationBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationBus);
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    afterEach(() => {
        unsubscribeNotifications();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        versionControlStore.set(createDefaultState());
        resetCrdtProjectAuthority('legacy version timeline snapshot cleanup');
        configureAutomergeStoragePort(null);
        Container.clear();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('restores the captured tempo map and take/comp state through the connected actions', async () => {
        await activateProject('Timeline Snapshot');
        const { takeAId, takeBId } = await seedTimelineFixture();

        // The version fixture: base 120 BPM, empty tempo map, take A selected
        // and comped across the clip.
        expect(transportStore.value?.tempo).toBe(120);
        expect(tempoMapStore.value?.changes).toEqual([]);
        expect(readSecondsAtBeat({ beat: 4 })).toBe(2);

        const versionId = await createCheckpoint('Comp base');
        const captured = capturedTimelineState();
        expect(captured.tempoMap).toEqual({ changes: [] });
        const capturedLanes = (captured.takeLanes as TakeLaneStoreState).lanes;
        expect(capturedLanes[0]?.takes.find((take) => take.id === takeAId)?.selected).toBe(true);
        expect(capturedLanes[0]?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 8, takeId: takeAId }]);

        // Later edits: a beat-0 60 BPM event (the write route the tempo editor
        // calls — no Command action creates tempo-map events) and a take change
        // (both through the production Command actions).
        addTempoChange(0, 60);
        await selectTakeAndComp(takeBId);

        // The mutation landed before restoring.
        expect(tempoMapStore.value?.changes).toEqual([expect.objectContaining({ beat: 0, tempo: 60 })]);
        expect(currentLane().takes.find((take) => take.id === takeBId)?.selected).toBe(true);
        expect(currentLane().activeCompRegions).toEqual([{ startBeat: 0, endBeat: 8, takeId: takeBId }]);
        expect(readSecondsAtBeat({ beat: 4 })).toBe(4);

        const outcome = await dispatchRestore(versionId);

        expect(outcome.rejectionName).toBeUndefined();
        expect(outcome.committed).toHaveBeenCalledOnce();
        expect(notifications).toEqual([]);

        // Projections: the captured empty map and take A's selection return.
        expect(structuredClone(tempoMapStore.value)).toEqual(captured.tempoMap);
        expect(structuredClone(takeLaneStore.value)).toEqual(captured.takeLanes);
        expect(currentLane().takes.find((take) => take.id === takeAId)?.selected).toBe(true);
        expect(readSecondsAtBeat({ beat: 4 })).toBe(2);

        // Raw document: the restored state reached the CRDT slots too.
        expect(readRawTimelineSlots()).toEqual(captured.raw);
    });

    it('restores a legacy payload without timeline slots and holds the current tempo map and take lanes', async () => {
        await activateProject('Timeline Snapshot Legacy');
        const { takeBId } = await seedTimelineFixture();
        const versionId = await createCheckpoint('Comp base');

        stripTimelineSlotsFromVersion(versionId);

        addTempoChange(0, 60);
        await selectTakeAndComp(takeBId);
        expect(readSecondsAtBeat({ beat: 4 })).toBe(4);

        const outcome = await dispatchRestore(versionId);

        expect(outcome.rejectionName).toBeUndefined();
        expect(outcome.committed).toHaveBeenCalledOnce();
        expect(notifications).toEqual([]);

        // The omission is tolerated: nothing historical is invented, so the
        // later tempo event and take-lane state survive the restore.
        expect(tempoMapStore.value?.changes).toEqual([expect.objectContaining({ beat: 0, tempo: 60 })]);
        expect(currentLane().takes.find((take) => take.id === takeBId)?.selected).toBe(true);
        expect(readSecondsAtBeat({ beat: 4 })).toBe(4);
    });

    it('refuses a foreign-owned snapshot without touching the timeline state', async () => {
        await activateProject('Timeline Snapshot Foreign');
        await seedTimelineFixture();
        const before = {
            ...capturedTimelineState(),
            tracks: structuredClone(trackStore.value),
            transport: structuredClone(transportStore.value),
        };

        const catalog = versionControlStore.value;
        if (!catalog) {
            throw new Error('expected a live version-control catalog');
        }
        const foreignSnapshot = JSON.stringify({
            // Would wipe the arrangement if the owner guard failed to refuse.
            tracks: { tracks: [], selectedTrackId: null },
            tempoMap: { changes: [{ id: 'tempo-foreign', beat: 0, tempo: 30, curve: 'instant' }] },
            takeLanes: { lanes: [] },
            timestamp: Date.now(),
        });
        const foreignVersion: ProjectVersion = {
            id: 'ver-foreign',
            label: 'Foreign',
            createdAt: '2024-01-01T00:00:00.000Z',
            parentId: null,
            description: '',
            snapshot: {
                ownerProjectId: FOREIGN_OWNER_PROJECT_ID,
                data: foreignSnapshot,
                size: new TextEncoder().encode(foreignSnapshot).byteLength,
            },
            tags: [],
        };
        versionControlStore.set({ ...catalog, versions: [...catalog.versions, foreignVersion] });

        const outcome = await dispatchRestore('ver-foreign');

        expect.soft([undefined, 'AppActionConflictError']).toContain(outcome.rejectionName);
        expect.soft(outcome.committed).not.toHaveBeenCalled();
        expect.soft(notifications).toEqual([expect.objectContaining({ level: 'error' })]);
        expect({
            ...capturedTimelineState(),
            tracks: structuredClone(trackStore.value),
            transport: structuredClone(transportStore.value),
        }).toEqual(before);
    });
});
