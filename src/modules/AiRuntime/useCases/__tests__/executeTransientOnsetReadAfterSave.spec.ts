import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type readClipTransientOnsets } from '#/modules/ElasticAudio/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

import { executeTransientOnsetRead } from '../executeTransientOnsetRead';

// The revision check is the real one over a real CRDT document and a real save write; only the
// source reader, which owns the audio, is replaced.
const mocks = vi.hoisted(() => ({
    readSource: vi.fn<typeof readClipTransientOnsets>(),
    projectId: vi.fn(),
}));

vi.mock('#/modules/ElasticAudio/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ElasticAudio/useCases')>()),
    readClipTransientOnsets: mocks.readSource,
}));
vi.mock('#/modules/Project/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/stores')>()),
    getSettledProjectId: mocks.projectId,
}));

const PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function moveFader(gain: number): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => (track.id === 'track-1' ? { ...track, gain } : track)),
        selectedTrackId: null,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

/** The recheck the reader hands the source owner, as `readClipTransientOnsets` would call it. */
async function readRecheck(projectRevision: string): Promise<() => boolean> {
    mocks.readSource.mockResolvedValue({ status: 'unavailable' } as unknown as Awaited<
        ReturnType<typeof readClipTransientOnsets>
    >);
    const reader = executeTransientOnsetRead({
        projectRevision,
        admit: () => ({ status: 'admitted', settle: vi.fn() }),
    });
    await reader.execute({
        call: { name: 'analysis.detectTransients', arguments: { clipId: 'clip-1' } },
        callId: 'call-1',
        turn: 1,
    } as Parameters<typeof reader.execute>[0]);
    reader.dispose();
    const input = mocks.readSource.mock.calls[0]?.[0];
    if (input === undefined) {
        throw new Error('The reader never reached the source owner');
    }
    return input.isProjectRevisionCurrent;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId.mockReturnValue(PROJECT_ID);
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('transient read after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    projectStore.set(defaultProjectStoreState);
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'track-1', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('transient onset read after a save', () => {
    it('keeps the captured revision current after the project is saved', async () => {
        const revision = captureProjectRevision();
        const isCurrent = await readRecheck(revision);

        await writeSave();

        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision)).toBe(false);
        expect(isCurrent()).toBe(true);
    });

    it('stops being current once a fader moves, saved or not', async () => {
        const revision = captureProjectRevision();
        const isCurrent = await readRecheck(revision);

        moveFader(0.5);
        await writeSave();

        expect(isCurrent()).toBe(false);
    });
});
