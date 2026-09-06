import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    projectFileIoFixture,
    resetProjectFileIoFixture,
} from '../../../../repositories/__tests__/projectFileIoTestFixture';

const audioRuntime = vi.hoisted(() => ({
    exportCachedAudioBuffers: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        clearRuntimeCachedAudioBuffers: vi.fn(),
        exportCachedAudioBuffers: audioRuntime.exportCachedAudioBuffers,
        getAudioContext: vi.fn(() => ({})),
        importCachedAudioBuffers: vi.fn(() =>
            Promise.resolve({ persist: () => Promise.resolve(true), publish: () => 0 })
        ),
        prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: () => undefined, publish: () => 0 })),
        resetAudioGraph: vi.fn(),
        setMasterGainValue: vi.fn(),
    };
});

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    ensureTrackStrips: vi.fn(() => ({ status: 'ready', externalPluginActivations: [] })),
    stopPlayback: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../saveProject/captureExternalPluginStates', () => ({
    captureExternalPluginStates: vi.fn(() => Promise.resolve()),
}));

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { addTempoChange, getTransportHandlers, updateTempoChange } from '#/modules/Transport/useCases';

import { deriveDeterministicProjectId, type ProjectData } from '../../../../models/ProjectData';
import { projectStore } from '../../../../stores/projectStore';
import { stopActiveAutoSave } from '../../helpers/stopActiveAutoSave';
import { newProject } from '../../newProject';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { installMultiDatabaseIndexedDb } from '../../saveProject/__tests__/multiDatabaseIndexedDb';
import { applyImportedProjectData } from '../applyImportedProjectData';
import { buildProjectData } from '../buildProjectData';
import { exportProjectFile } from '../exportProjectFile';

const AUDIO_BUFFER_A = 'buffer-a';
const AUDIO_PAYLOAD_A = {
    [AUDIO_BUFFER_A]: {
        sampleRate: 48_000,
        numberOfChannels: 1,
        channelData: ['AAAA'],
    },
};

type CoherentProjectSnapshot = Pick<ProjectData, 'arrangement' | 'audioBuffers' | 'markers' | 'meta' | 'tempoMap'>;

function deferred<Value>(): {
    promise: Promise<Value>;
    resolve: (value: Value) => void;
} {
    let resolveDeferred!: (value: Value) => void;
    const promise = new Promise<Value>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assertCoherentProjectShape(value: unknown): asserts value is CoherentProjectSnapshot {
    if (!isRecord(value)) {
        throw new TypeError('Expected serialized project data');
    }
    const meta = value.meta;
    const arrangement = value.arrangement;
    const tempoMap = value.tempoMap;
    if (
        !isRecord(meta) ||
        typeof meta.projectId !== 'string' ||
        typeof meta.name !== 'string' ||
        !isRecord(arrangement) ||
        !Array.isArray(arrangement.tracks) ||
        !Array.isArray(value.markers) ||
        !isRecord(tempoMap) ||
        !Array.isArray(tempoMap.changes) ||
        !isRecord(value.audioBuffers)
    ) {
        throw new TypeError('Expected coherent project identity, tracks, markers, tempo, and media');
    }
}

function createBrowserFileHandle(writable: FileSystemWritableFileStream): FileSystemFileHandle {
    const name = 'Project_A.sourdaw';
    const handle: FileSystemFileHandle = {
        kind: 'file',
        name,
        createSyncAccessHandle: (): Promise<FileSystemSyncAccessHandle> =>
            Promise.reject(new Error('Synchronous access is not supported by this test fixture')),
        createWritable: () => Promise.resolve(writable),
        getFile: () => Promise.resolve(new File([], name)),
        isSameEntry: (other) => Promise.resolve(other === handle),
        queryPermission: (_descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> =>
            Promise.resolve<PermissionState>('denied'),
        requestPermission: (_descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> =>
            Promise.resolve<PermissionState>('denied'),
    };
    return handle;
}

async function seedProjectA(): Promise<void> {
    expect(await newProject('Project A')).toBe(true);
    await executeAppAction({
        type: 'addTrack',
        payload: { id: 'track-a', name: 'A Track', kind: 'audio', select: false },
    });
    await executeAppAction({
        type: 'addClip',
        payload: {
            id: 'clip-a',
            trackId: 'track-a',
            startBeat: 0,
            endBeat: 4,
            name: 'A Clip',
            type: 'audio',
            audioBufferId: AUDIO_BUFFER_A,
        },
    });
    await executeAppAction({
        type: 'addMarker',
        payload: { markerId: 'marker-a', beat: 4, name: 'A Marker', color: '#aa0000' },
    });
    addTempoChange(0, 111);
    flushAutomergeStorageWrites();
}

async function projectBData(): Promise<ProjectData> {
    const built = await buildProjectData();
    if (!built) {
        throw new Error('Expected Project A to produce an importable snapshot');
    }
    return {
        ...structuredClone(built.data),
        meta: {
            ...structuredClone(built.data.meta),
            projectId: deriveDeterministicProjectId('project-b'),
            name: 'Project B',
            createdAt: 2_000_000_000_000,
            updatedAt: 2_000_000_000_000,
        },
        arrangement: { tracks: [] },
        arrangements: undefined,
        activeArrangementId: undefined,
        markers: [],
        tempoMap: { changes: [] },
        audioBuffers: undefined,
    };
}

async function switchToProjectB(data: ProjectData): Promise<void> {
    expect(await applyImportedProjectData({ data })).toBe(true);
    await executeAppAction({
        type: 'addTrack',
        payload: { id: 'track-b', name: 'B Track', kind: 'audio', select: false },
    });
    await executeAppAction({
        type: 'addMarker',
        payload: { markerId: 'marker-b', beat: 8, name: 'B Marker', color: '#0000aa' },
    });
    addTempoChange(0, 222);
    flushAutomergeStorageWrites();
}

function expectCoherentProjectA(data: CoherentProjectSnapshot, projectId: string | undefined): void {
    expect(data.meta).toMatchObject({
        projectId,
        name: 'Project A',
    });
    expect(data.arrangement.tracks.map((track) => track.name)).toEqual(['Master', 'A Track']);
    expect(data.markers).toEqual([expect.objectContaining({ id: 'marker-a', beat: 4, name: 'A Marker' })]);
    expect(data.tempoMap?.changes).toEqual([expect.objectContaining({ beat: 0, tempo: 111 })]);
    expect(data.audioBuffers).toEqual(AUDIO_PAYLOAD_A);
}

describe('project export snapshot consistency integration', () => {
    beforeEach(async () => {
        Container.clear();
        localStorage.clear();
        installMultiDatabaseIndexedDb();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('export snapshot bootstrap');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        resetProjectFileIoFixture();
        audioRuntime.exportCachedAudioBuffers.mockReset();
        await seedProjectA();
    });

    afterEach(() => {
        stopActiveAutoSave();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('returns no snapshot when a marker changes during PCM export', async () => {
        const pcm = deferred<Record<string, never>>();
        audioRuntime.exportCachedAudioBuffers.mockReturnValueOnce(pcm.promise);
        const before = captureProjectRevision();

        const building = buildProjectData({ includeAudioBuffers: true });
        await vi.waitFor(() => expect(audioRuntime.exportCachedAudioBuffers).toHaveBeenCalledOnce());
        await executeAppAction({
            type: 'addMarker',
            payload: { markerId: 'marker-after-capture', beat: 12, name: 'Later Marker' },
        });
        expect(captureProjectRevision()).not.toBe(before);
        pcm.resolve({});

        await expect(building).resolves.toBeNull();
    });

    it('returns no snapshot when the tempo map changes during PCM export', async () => {
        const pcm = deferred<Record<string, never>>();
        audioRuntime.exportCachedAudioBuffers.mockReturnValueOnce(pcm.promise);
        const seeded = await buildProjectData();
        const tempoChangeId = seeded?.data.tempoMap?.changes[0]?.id;
        if (!tempoChangeId) {
            throw new Error('Expected the seeded tempo-map entry');
        }
        const before = captureProjectRevision();

        const building = buildProjectData({ includeAudioBuffers: true });
        await vi.waitFor(() => expect(audioRuntime.exportCachedAudioBuffers).toHaveBeenCalledOnce());
        updateTempoChange(tempoChangeId, 177);
        expect(captureProjectRevision()).not.toBe(before);
        pcm.resolve({});

        await expect(building).resolves.toBeNull();
    });

    it('returns no snapshot when Project A is replaced by Project B during PCM export', async () => {
        const incoming = await projectBData();
        const pcm = deferred<Record<string, never>>();
        audioRuntime.exportCachedAudioBuffers.mockReturnValueOnce(pcm.promise);
        const before = captureProjectRevision();

        const building = buildProjectData({ includeAudioBuffers: true });
        await vi.waitFor(() => expect(audioRuntime.exportCachedAudioBuffers).toHaveBeenCalledOnce());
        await switchToProjectB(incoming);
        expect(projectStore.value).toMatchObject({ projectId: incoming.meta.projectId, name: 'Project B' });
        expect(captureProjectRevision()).not.toBe(before);
        pcm.resolve({});

        await expect(building).resolves.toBeNull();
    });

    it('builds one complete coherent Project A snapshot when the revision stays unchanged', async () => {
        audioRuntime.exportCachedAudioBuffers.mockResolvedValueOnce(AUDIO_PAYLOAD_A);

        const built = await buildProjectData({ includeAudioBuffers: true });

        expect(built).not.toBeNull();
        if (!built) {
            throw new Error('Expected a stable export snapshot');
        }
        expect(built.snapshotRevision).toBe(captureProjectRevision());
        expect(built.requiredAudioBufferIds).toEqual([AUDIO_BUFFER_A]);
        expect(built.missingBufferCount).toBe(0);
        expectCoherentProjectA(built.data, projectStore.value?.projectId);
    });

    it('writes the coherent completed snapshot through the real native serializer after a delayed dialog', async () => {
        projectFileIoFixture.desktop = true;
        audioRuntime.exportCachedAudioBuffers.mockResolvedValueOnce(AUDIO_PAYLOAD_A);
        const projectIdA = projectStore.value?.projectId;
        const dialog = deferred<string | null>();
        projectFileIoFixture.desktopSaveDialog.mockReturnValueOnce(dialog.promise);

        const exporting = exportProjectFile();
        await vi.waitFor(() => expect(projectFileIoFixture.desktopSaveDialog).toHaveBeenCalledOnce());
        await executeAppAction({
            type: 'addMarker',
            payload: { markerId: 'marker-after-dialog', beat: 16, name: 'After Dialog' },
        });
        const live = await buildProjectData();
        const tempoChangeId = live?.data.tempoMap?.changes[0]?.id;
        if (!tempoChangeId) {
            throw new Error('Expected the seeded tempo-map entry');
        }
        updateTempoChange(tempoChangeId, 188);
        dialog.resolve('/tmp/project-a.sourdaw');
        await exporting;

        expect(projectFileIoFixture.writeFileBytes).toHaveBeenCalledOnce();
        const written = projectFileIoFixture.writeFileBytes.mock.calls[0]?.[0];
        if (!written) {
            throw new Error('Expected native bytes');
        }
        const decoded: unknown = JSON.parse(new TextDecoder().decode(written.bytes));
        assertCoherentProjectShape(decoded);
        expect(decoded.meta.projectId).toBe(projectIdA);
        expectCoherentProjectA(decoded, projectIdA);
    });

    it('writes the coherent completed snapshot Blob after Project B replaces the live project during a browser picker', async () => {
        const incoming = await projectBData();
        audioRuntime.exportCachedAudioBuffers.mockResolvedValueOnce(AUDIO_PAYLOAD_A);
        const projectIdA = projectStore.value?.projectId;
        const picker = deferred<FileSystemFileHandle>();
        const write = vi.fn((_data: FileSystemWriteChunkType) => Promise.resolve());
        const close = vi.fn(() => Promise.resolve());
        const abort = vi.fn(() => Promise.resolve());
        const writable: FileSystemWritableFileStream = Object.assign(new WritableStream(), {
            abort,
            close,
            seek: vi.fn((_position: number) => Promise.resolve()),
            truncate: vi.fn((_size: number) => Promise.resolve()),
            write,
        });
        const showSaveFilePicker = vi.fn(() => picker.promise);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

        const exporting = exportProjectFile();
        await vi.waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledOnce());
        await switchToProjectB(incoming);
        picker.resolve(createBrowserFileHandle(writable));
        await exporting;

        expect(write).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(abort).not.toHaveBeenCalled();
        const blob = write.mock.calls[0]?.[0];
        if (!(blob instanceof Blob)) {
            throw new TypeError('Expected the browser writer to receive a Blob');
        }
        const decoded: unknown = JSON.parse(await blob.text());
        assertCoherentProjectShape(decoded);
        expect(decoded.meta.projectId).toBe(projectIdA);
        expectCoherentProjectA(decoded, projectIdA);
    });
});
