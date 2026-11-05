import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
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

import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { getArrangementHandlers, setArrangementEventBus } from '../../index';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its transaction, the failure diagnostic's settlement and the revision check
// are the real ones over a real CRDT document and a real save write; only the offline render, which
// owns the audio, is replaced.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function moveFader(trackId: string, gain: number): void {
    const state = trackStore.value;
    if (!state) {
        throw new Error('A fader edit needs a track list.');
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, gain } : track)),
    });
    flushAutomergeStorageWrites();
}

function freezeStatus(trackId: string): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.freezeState.status;
}

/** Freezes `track-1` through its action, running `duringRender` while the render is in flight; the render then fails. */
async function freezeFailingAfter(duringRender: () => Promise<void>): Promise<void> {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    vi.mocked(renderTrackOffline).mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        throw new Error('Render crashed');
    });
    const freezing = executeAppAction({ type: 'freezeTrack', payload: { trackId: 'track-1' } });
    await entered.promise;
    await duringRender();
    resume.resolve();
    await freezing.catch(() => undefined);
}

beforeEach(() => {
    vi.mocked(renderTrackOffline).mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    projectStore.set(structuredClone(defaultProjectStoreState));
    trackStore.set({
        tracks: [
            createTrack({ id: 'track-1', name: 'Keys', kind: 'audio' }),
            createTrack({ id: 'track-2', name: 'Bass', kind: 'audio' }),
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
});

afterEach(() => {
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('a failed freeze render across a save', () => {
    it('records the failure on the track when the project was saved during the render', async () => {
        await freezeFailingAfter(writeSave);

        expect(freezeStatus('track-1')).toBe('error');
    });

    it('records no failure once another track’s fader moved during the render, saved or not', async () => {
        await freezeFailingAfter(async () => {
            moveFader('track-2', 0.5);
            await writeSave();
        });

        expect(freezeStatus('track-1')).not.toBe('error');
    });

    it('records the failure when nothing touched the project during the render', async () => {
        await freezeFailingAfter(async () => undefined);

        expect(freezeStatus('track-1')).toBe('error');
    });
});
