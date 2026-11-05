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
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

import { renderAgentMeasurementScope } from '../renderAgentMeasurementScope';

// The revision checks are the real ones over a real CRDT document and a real save write; only the
// engine's render boundary is replaced.
const engine = vi.hoisted(() => ({ renderOffline: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
}));

function fakeBuffer(frameCount = 4): AudioBuffer {
    const channel = new Float32Array(frameCount);
    return {
        sampleRate: 48_000,
        length: frameCount,
        numberOfChannels: 1,
        duration: frameCount / 48_000,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

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

function measureMaster(sourceRevision: string) {
    return renderAgentMeasurementScope({ scope: { kind: 'master' }, startBeat: 0, endBeat: 4, sourceRevision });
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('measurement render after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    projectStore.set(defaultProjectStoreState);
    trackStore.set({
        tracks: [
            createTrack({ id: 'master', name: 'master', kind: 'master' }),
            createTrack({ id: 'track-1', name: 'track-1', kind: 'audio' }),
        ],
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
    engine.renderOffline.mockReset().mockResolvedValue(fakeBuffer());
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('renderAgentMeasurementScope after a save', () => {
    it('renders a project saved before the render starts', async () => {
        const revision = captureProjectRevision();
        await writeSave();
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision)).toBe(false);

        const result = await measureMaster(revision);

        expect(result.status).toBe('rendered');
        expect(engine.renderOffline).toHaveBeenCalledTimes(1);
    });

    it('renders a project saved while the render runs', async () => {
        const revision = captureProjectRevision();
        engine.renderOffline.mockImplementation(async () => {
            await writeSave();
            return fakeBuffer();
        });

        const result = await measureMaster(revision);

        expect(result.status).toBe('rendered');
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision)).toBe(false);
    });

    it('refuses a project whose fader moved before the render, saved or not', async () => {
        const revision = captureProjectRevision();
        moveFader(0.5);
        await writeSave();

        const result = await measureMaster(revision);

        expect(result).toMatchObject({ status: 'refused', code: 'stale-revision' });
        expect(engine.renderOffline).not.toHaveBeenCalled();
    });

    it('refuses a project whose fader moves while the render runs, saved or not', async () => {
        const revision = captureProjectRevision();
        engine.renderOffline.mockImplementation(async () => {
            moveFader(0.5);
            await writeSave();
            return fakeBuffer();
        });

        const result = await measureMaster(revision);

        expect(result).toMatchObject({ status: 'refused', code: 'stale-revision' });
    });
});
