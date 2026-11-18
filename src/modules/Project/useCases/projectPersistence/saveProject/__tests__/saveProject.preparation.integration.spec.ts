import { performance as nativePerformance } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';

import { getHeads, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { NativePreparationWorker, settleNativePreparationWorkers } from '#/helpers/__tests__/nativePreparationWorker';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { isRecord } from '#/utils/structuralEquality';

import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';

import { installMultiDatabaseIndexedDb } from './multiDatabaseIndexedDb';

import type { TrackStoreState } from '#/modules/Arrangement/stores';
import type { ActionHistoryState } from '#/modules/CrdtDocument/stores';
import type { ProjectMeta } from '../../../../models/ProjectData';
import type { ArrangementStoreState } from '../../../../stores/arrangementStore';

const CREATED_AT = 1_700_000_000_000;
const SAVED_AT = CREATED_AT + 2_000;
const INITIAL_NAME = 'Dry drums';
const EDITED_NAME = 'New drum balance';
const ACTIVE = 'active-take';
const INACTIVE = 'alternate-take';
const SOURCE_TRACK = 'dry-drum-track';
const SOURCE_CLIP = 'dry-drum-clip';
const SOURCE_PCM = 'dry-drum-pcm';
const ALTERNATE_TRACK = 'room-drum-track';
const ALTERNATE_CLIP = 'room-drum-clip';
const ALTERNATE_PCM = 'room-drum-pcm';
const DRY_FRAMES = [
    [0.25, -0.5, 0.125],
    [0.75, -0.25, 0.5],
];
const ROOM_FRAMES = [
    [0.5, 0.125, -0.75],
    [0.25, -0.125, 0.375],
];

type NativeRoot = {
    projectMeta: ProjectMeta;
    tracks: TrackStoreState;
    arrangements: ArrangementStoreState;
    actionHistory: ActionHistoryState;
};

type WorkerRequest = { key: unknown; policy: unknown };
type HeldReply = { kind: 'worker'; response: unknown; release: () => void };

const requests: WorkerRequest[] = [];
let nextReply: ReturnType<typeof Promise.withResolvers<HeldReply>> | undefined;

class PublicSaveWorker extends NativePreparationWorker {
    override postMessage(data: unknown, transfer: ArrayBuffer[]): void {
        if (!isRecord(data) || !isRecord(data.mutation)) {
            throw new Error('Expected a real prospective mutation request');
        }
        requests.push({ key: data.mutation.key, policy: data.preparationPolicy });
        const held = nextReply;
        if (held) {
            nextReply = undefined;
            let delivery: (() => void) | undefined;
            const handler = requireValue(this.onmessage);
            this.onmessage = (event) => {
                delivery = () => handler.call(this, event);
                held.resolve({
                    kind: 'worker',
                    response: event.data,
                    release: () => {
                        const deliver = delivery;
                        delivery = undefined;
                        deliver?.();
                    },
                });
            };
        }
        super.postMessage(data, transfer);
    }
}

function requireValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('Expected the seeded public Save project');
    }
    return value;
}

function findRow<Row extends { id: string }>(rows: readonly Row[] | undefined, id: string): Row {
    return requireValue(rows?.find((row) => row.id === id));
}

function audioBuffer(frames: number[][]): AudioBuffer {
    const buffer = MockAudioBuffer.create(frames.length, requireValue(frames[0]).length, 48_000);
    for (const [index, channel] of frames.entries()) {
        buffer.copyToChannel(new Float32Array(channel), index);
    }
    return buffer;
}

async function registerSaveRuntime() {
    const [
        { getProductionCommandHandlerMaps },
        { eventBus },
        { registerKernelPorts },
        { registerProjectLifecycle },
        { registerProjectSlotProjections },
        { registerSupportingServicePorts },
        { setNotificationEventBus },
        arrangement,
        audio,
        collaboration,
        command,
        crdt,
        project,
    ] = await Promise.all([
        import('#/app/getProductionCommandHandlerMaps'),
        import('#/app/registerDependencies'),
        import('#/app/registerKernelPorts'),
        import('#/app/registerProjectLifecycle'),
        import('#/app/registerProjectSlotProjections'),
        import('#/app/registerSupportingServicePorts'),
        import('#/utils/Notification/notificationEventBus'),
        import('#/modules/Arrangement/useCases'),
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/Collaboration/useCases'),
        import('#/modules/Command/useCases'),
        import('#/modules/CrdtDocument/useCases'),
        import('#/modules/Project/useCases'),
    ]);

    const context = audio.audioEngine.context;
    context.createBuffer = MockAudioBuffer.create;
    await audio.restoreCachedAudioBuffersFromIdb({ audioContext: context });
    crdt.registerCrdtStorageRuntime();
    registerProjectSlotProjections();
    registerProjectLifecycle();
    registerSupportingServicePorts();
    registerKernelPorts();
    setNotificationEventBus(eventBus);
    arrangement.setArrangementEventBus(eventBus);
    command.setActionHistoryMetadataPort({
        record: crdt.recordActionHistoryEntry,
        recordBatch: crdt.recordActionHistoryEntries,
        markReverted: crdt.markActionHistoryEntryReverted,
        clear: crdt.clearActionHistory,
    });
    command.registerProductionCommandHandlers(
        getProductionCommandHandlerMaps({ canMutateBranchMetadata: collaboration.canMutateBranchMetadata }),
        { deferSessionRestore: true }
    );
    collaboration.configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
    audio.configureDurableAudioBufferOwnership(project.collectDurableOwnedAudioBufferIds);
    project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: collaboration.leaveSession });
    return { arrangement, audio, command, crdt, project };
}

async function openSaveProject() {
    const indexedDb = installMultiDatabaseIndexedDb();
    const [
        { arrangement, audio, command, crdt, project },
        { trackStore },
        { undoHistoryStore },
        { actionHistoryStore },
        { flushAutomergeStorageWrites },
        { arrangementStore },
        { projectStore },
        { takeSnapshot },
        { createFreshProjectMetadata },
        { resetModuleStoresToDefault },
    ] = await Promise.all([
        registerSaveRuntime(),
        import('#/modules/Arrangement/stores'),
        import('#/modules/Command/stores'),
        import('#/modules/CrdtDocument/stores'),
        import('#/infra/store/storage/createAutomergeStorage'),
        import('../../../../stores/arrangementStore'),
        import('../../../../stores/projectStore'),
        import('../../../arrangement/takeSnapshot'),
        import('../../../createFreshProjectMetadata'),
        import('../../helpers/resetModuleStoresToDefault'),
    ]);
    crdt.resetCrdtProjectAuthority('Public Save preparation');
    resetModuleStoresToDefault();
    projectStore.set({
        ...createFreshProjectMetadata({ name: 'Public Save preparation', loading: false, initialized: true }),
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        dirty: true,
    });
    requireValue(arrangement.addTrack({ id: SOURCE_TRACK, name: 'Unbalanced drums', kind: 'audio' }));
    requireValue(arrangement.addTrack({ id: ALTERNATE_TRACK, name: 'Room microphones', kind: 'audio' }));
    expect(audio.cacheAudioBuffer({ bufferId: SOURCE_PCM, buffer: audioBuffer(DRY_FRAMES) })).toBe(SOURCE_PCM);
    expect(audio.cacheAudioBuffer({ bufferId: ALTERNATE_PCM, buffer: audioBuffer(ROOM_FRAMES) })).toBe(ALTERNATE_PCM);
    requireValue(
        arrangement.addClip({
            id: SOURCE_CLIP,
            trackId: SOURCE_TRACK,
            startBeat: 1.25,
            endBeat: 3.5,
            name: 'Dry snare',
            type: 'audio',
            audioBufferId: SOURCE_PCM,
        })
    );
    requireValue(
        arrangement.addClip({
            id: ALTERNATE_CLIP,
            trackId: ALTERNATE_TRACK,
            startBeat: 0.5,
            endBeat: 1.5,
            name: 'Room snare',
            type: 'audio',
            audioBufferId: ALTERNATE_PCM,
        })
    );
    flushAutomergeStorageWrites();

    async function renameSourceTrack(name: string): Promise<void> {
        await command.executeAppAction({ type: 'renameTrack', payload: { trackId: SOURCE_TRACK, name } });
        flushAutomergeStorageWrites();
    }
    await renameSourceTrack(INITIAL_NAME);
    const active = takeSnapshot(ACTIVE, 'Direct microphones');
    const inactive = takeSnapshot(INACTIVE, 'Room microphones only');
    inactive.tracks = { tracks: [findRow(inactive.tracks.tracks, ALTERNATE_TRACK)], selectedTrackId: ALTERNATE_TRACK };
    arrangementStore.set({ activeArrangementId: ACTIVE, arrangements: [active, inactive] });
    flushAutomergeStorageWrites();

    function readRoot() {
        return requireValue(crdt.getCrdtDoc<NativeRoot>('root'));
    }
    function readHistory() {
        return {
            native: toJS(readRoot()).actionHistory,
            actionHistory: structuredClone(actionHistoryStore.value),
            undo: structuredClone(undoHistoryStore.value),
        };
    }
    function readNamedRecord() {
        return indexedDb.get('sourdaw-projects', 'projects', project.getProjectSnapshotKey(CREATED_AT));
    }
    function readNamed() {
        const stored = readNamedRecord();
        if (typeof stored !== 'string') {
            throw new TypeError('The public Save did not write the named project');
        }
        const data: unknown = JSON.parse(stored);
        if (!isHydratableProjectData(data)) {
            throw new Error('The named project could not be hydrated');
        }
        return data;
    }
    return {
        arrangementStore,
        indexedDb,
        readRoot,
        readNamed,
        readNamedRecord,
        readHistory,
        renameProject: project.renameProject,
        renameSourceTrack,
        saveProject: project.saveProject,
        getRecentProjects: project.getRecentProjects,
        trackStore,
    };
}

type OpenedProject = Awaited<ReturnType<typeof openSaveProject>>;

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function expectDurablePcm(record: unknown, frames: number[][]): void {
    if (!isRecord(record) || !Array.isArray(record.channelData)) {
        throw new TypeError('Expected a durable audio record');
    }
    const channels: unknown[] = record.channelData;
    if (!channels.every(isFloat32Array)) {
        throw new TypeError('Durable audio must contain Float32 PCM');
    }
    expect(record.sampleRate).toBe(48_000);
    expect(record.numberOfChannels).toBe(frames.length);
    expect(channels.map((channel) => Array.from(channel))).toEqual(frames);
}

function expectSavedSources(opened: OpenedProject, name: string): void {
    const native = toJS(opened.readRoot());
    const named = opened.readNamed();
    const nativeTrack = findRow(findRow(native.arrangements.arrangements, ACTIVE).tracks.tracks, SOURCE_TRACK);
    const namedTrack = findRow(findRow(named.arrangements, ACTIVE).tracks?.tracks, SOURCE_TRACK);
    const currentTrack = findRow(named.arrangement.tracks, SOURCE_TRACK);
    expect(native.projectMeta).toMatchObject({ createdAt: CREATED_AT, updatedAt: SAVED_AT });
    expect(named.meta).toMatchObject({
        projectId: native.projectMeta.projectId,
        createdAt: CREATED_AT,
        updatedAt: SAVED_AT,
    });
    expect(native.arrangements.activeArrangementId).toBe(ACTIVE);
    expect(named.activeArrangementId).toBe(ACTIVE);
    expect(nativeTrack.name).toBe(name);
    expect(namedTrack.name).toBe(name);
    expect(currentTrack.name).toBe(name);
    const fingerprint = { id: SOURCE_CLIP, name: 'Dry snare', startBeat: 1.25, endBeat: 3.5 };
    expect(findRow(nativeTrack.clips, SOURCE_CLIP)).toMatchObject({ ...fingerprint, audioBufferId: SOURCE_PCM });
    expect(findRow(namedTrack.clips, SOURCE_CLIP)).toMatchObject({ ...fingerprint, bufferId: SOURCE_PCM });
    expect(findRow(currentTrack.clips, SOURCE_CLIP)).toMatchObject({ ...fingerprint, bufferId: SOURCE_PCM });
    const alternate = findRow(findRow(named.arrangements, INACTIVE).tracks?.tracks, ALTERNATE_TRACK);
    expect(findRow(alternate.clips, ALTERNATE_CLIP)).toMatchObject({
        id: ALTERNATE_CLIP,
        name: 'Room snare',
        startBeat: 0.5,
        endBeat: 1.5,
        bufferId: ALTERNATE_PCM,
    });
    expectDurablePcm(opened.indexedDb.get('sourdaw-audio', 'buffers', SOURCE_PCM), DRY_FRAMES);
    expectDurablePcm(opened.indexedDb.get('sourdaw-audio', 'buffers', ALTERNATE_PCM), ROOM_FRAMES);
}

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    requests.length = 0;
    nextReply = undefined;
    vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
    vi.stubGlobal('Worker', PublicSaveWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
    vi.stubGlobal('performance', nativePerformance);
});

afterEach(async () => {
    const [
        { configureDurableAudioBufferOwnership },
        { clearHandlerRegistry },
        { configureAutomergeStoragePort },
        { Container },
        { stopActiveAutoSave },
    ] = await Promise.all([
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/Command/stores'),
        import('#/infra/store/storage/createAutomergeStorage'),
        import('#/infra/di/Container'),
        import('../../helpers/stopActiveAutoSave'),
    ]);
    await settleNativePreparationWorkers();
    stopActiveAutoSave();
    configureDurableAudioBufferOwnership(null);
    clearHandlerRegistry();
    configureAutomergeStoragePort(null);
    Container.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('public Save of the active arrangement', () => {
    it('saves a coherent arrangement with durable PCM through the normal project path', async () => {
        const opened = await openSaveProject();
        const before = toJS(opened.readRoot());
        const history = opened.readHistory();
        expect(history.native.entries.map((entry) => entry.actionKind)).toEqual(['renameTrack']);
        expect(history.undo?.past).toHaveLength(1);
        vi.spyOn(Date, 'now').mockReturnValue(SAVED_AT);

        await expect(opened.saveProject()).resolves.toBe(true);

        expectSavedSources(opened, INITIAL_NAME);
        expect(opened.readHistory()).toEqual(history);
        expect(toJS(opened.readRoot()).arrangements).toEqual(before.arrangements);
    }, 30_000);

    it('waits for bounded native preparation before persisting the edited active arrangement', async () => {
        const opened = await openSaveProject();
        await opened.renameSourceTrack(EDITED_NAME);
        const before = opened.readRoot();
        const beforeTruth = toJS(before);
        const beforeHeads = getHeads(before);
        const history = opened.readHistory();
        const source = findRow(requireValue(opened.trackStore.value).tracks, SOURCE_TRACK);
        const oldActive = findRow(beforeTruth.arrangements.arrangements, ACTIVE);
        const oldInactive = findRow(beforeTruth.arrangements.arrangements, INACTIVE);
        expect(source.name).toBe(EDITED_NAME);
        expect(findRow(beforeTruth.tracks.tracks, SOURCE_TRACK).name).toBe(EDITED_NAME);
        expect(findRow(oldActive.tracks.tracks, SOURCE_TRACK).name).toBe(INITIAL_NAME);
        expect(
            findRow(findRow(opened.arrangementStore.value?.arrangements, ACTIVE).tracks.tracks, SOURCE_TRACK).name
        ).toBe(INITIAL_NAME);
        expect(history.native.entries.map((entry) => entry.actionKind)).toEqual(['renameTrack', 'renameTrack']);
        expect(history.undo?.past).toHaveLength(2);
        vi.spyOn(Date, 'now').mockReturnValue(SAVED_AT);
        const held = Promise.withResolvers<HeldReply>();
        nextReply = held;
        const saving = opened.saveProject();
        const settlement = Promise.allSettled([saving]);
        const outcome = await Promise.race([held.promise, saving.then((saved) => ({ kind: 'save' as const, saved }))]);
        if (outcome.kind === 'save') {
            let namedTrackName: string | undefined;
            if (opened.readNamedRecord() !== undefined) {
                namedTrackName = findRow(
                    findRow(opened.readNamed().arrangements, ACTIVE).tracks?.tracks,
                    SOURCE_TRACK
                ).name;
            }
            const nativeTrack = findRow(
                findRow(opened.readRoot().arrangements.arrangements, ACTIVE).tracks.tracks,
                SOURCE_TRACK
            );
            throw new Error(
                `Public Save returned ${outcome.saved} before a bounded arrangement Worker reply. ` +
                    `Requests: ${JSON.stringify(requests)}. Native active: "${nativeTrack.name}", named active: "${String(namedTrackName)}".`
            );
        }
        try {
            expect(requests).toEqual([{ key: 'arrangements', policy: 'bounded-native-sequence-v1' }]);
            expect(outcome.response).toMatchObject({
                status: 'complete',
                sequence: { changeCount: expect.any(Number) },
            });
            expect(opened.readRoot()).toBe(before);
            expect(getHeads(opened.readRoot())).toEqual(beforeHeads);
            expect(toJS(opened.readRoot())).toEqual(beforeTruth);
            expect(opened.readNamedRecord()).toBeUndefined();
            // The named snapshot must inherit the timestamp that the
            // transaction captured before sending this Worker request.
            vi.mocked(Date.now).mockReturnValue(SAVED_AT + 1);
        } finally {
            outcome.release();
            await settlement;
        }

        expect(await settlement).toEqual([{ status: 'fulfilled', value: true }]);
        expectSavedSources(opened, EDITED_NAME);
        const after = toJS(opened.readRoot());
        expect(findRow(after.arrangements.arrangements, INACTIVE)).toEqual(oldInactive);
        expect(findRow(findRow(after.arrangements.arrangements, ACTIVE).tracks.tracks, ALTERNATE_TRACK)).toEqual(
            findRow(oldActive.tracks.tracks, ALTERNATE_TRACK)
        );
        expect(after.tracks).toEqual(beforeTruth.tracks);
        expect(opened.readHistory()).toEqual(history);
    }, 30_000);

    it('replans the same native project after a rename and records the committed name in Recent', async () => {
        const opened = await openSaveProject();
        await opened.renameSourceTrack(EDITED_NAME);
        const history = opened.readHistory();
        vi.spyOn(Date, 'now').mockReturnValue(SAVED_AT);
        const first = Promise.withResolvers<HeldReply>();
        nextReply = first;
        const saving = opened.saveProject();
        const settlement = Promise.allSettled([saving]);
        const settled = saving.then((saved) => ({ kind: 'save' as const, saved }));
        const stale = await Promise.race([first.promise, settled]);
        if (stale.kind === 'save') {
            throw new Error('Save settled before the initial Worker reply');
        }

        const retry = Promise.withResolvers<HeldReply>();
        try {
            opened.renameProject('Renamed during Save');
            expect(opened.readNamedRecord()).toBeUndefined();
            nextReply = retry;
        } finally {
            stale.release();
        }

        const current = await Promise.race([retry.promise, settled]);
        if (current.kind === 'save') {
            throw new Error('Save settled before the same-project retry');
        }
        try {
            expect(requests).toEqual([
                { key: 'arrangements', policy: 'bounded-native-sequence-v1' },
                { key: 'arrangements', policy: 'bounded-native-sequence-v1' },
            ]);
            expect(opened.readRoot().projectMeta).toMatchObject({ name: 'Renamed during Save', updatedAt: CREATED_AT });
            expect(opened.readNamedRecord()).toBeUndefined();
        } finally {
            current.release();
            await settlement;
        }

        expect(await settlement).toEqual([{ status: 'fulfilled', value: true }]);
        expectSavedSources(opened, EDITED_NAME);
        expect(opened.readNamed().meta.name).toBe('Renamed during Save');
        expect(opened.getRecentProjects()).toMatchObject([{ name: 'Renamed during Save' }]);
        expect(opened.readHistory()).toEqual(history);
    }, 30_000);
});
