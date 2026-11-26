import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    cacheAudioBuffer,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, removeClip, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its commit and the clip writes are the real ones over a real CRDT document.
// Only the offline render, which owns the audio, is replaced; like the real one it reads the input
// the freeze captured and hands it, never the live stores.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
}));

const TRACK_ID = 'track-1';
const LATE_CLIP_ID = 'late-clip';
const CHANGED_MESSAGE = 'The track changed while it was freezing. Freeze it again.';

function findTrack() {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('Expected the fixture track');
    }
    return track;
}

function renderedBuffer(): AudioBuffer {
    const channel = new Float32Array(4410).fill(0.25);
    return {
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        duration: 0.1,
        getChannelData: vi.fn(() => channel),
        sampleRate: 44100,
        length: 4410,
        numberOfChannels: 1,
    };
}

function resetProject(kind: 'audio' | 'midi'): void {
    trackStore.set({
        tracks: [createTrack({ id: TRACK_ID, name: 'Source', kind })],
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
    addClip({ id: 'first-clip', trackId: TRACK_ID, startBeat: 0, endBeat: 4, name: 'First', type: kind });
}

function addLateClip(kind: 'audio' | 'midi'): void {
    addClip({ id: LATE_CLIP_ID, trackId: TRACK_ID, startBeat: 4, endBeat: 8, name: 'Late', type: kind });
    if (kind === 'midi') {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                [LATE_CLIP_ID]: [{ id: 'late-note', pitch: 64, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
    }
}

beforeEach(() => {
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze clip edited during render test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    projectStore.set(structuredClone(defaultProjectStoreState));
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

/** The clip ids of the target in the input the freeze handed its render. */
function capturedClipIds(options: Parameters<typeof renderTrackOffline>[3]): string[] {
    const target = options?.captured?.source.project.tracks?.tracks.find((candidate) => candidate.id === TRACK_ID);
    return (target?.clips ?? []).map((clip) => clip.id);
}

/** The same content in new arrays, as a projection rebuild or a write that recreates the track would. */
function rebuildTrackArraysWithIdenticalContent(): void {
    const state = trackStore.value!;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((candidate) => ({
            ...candidate,
            clips: structuredClone(candidate.clips),
            devices: structuredClone(candidate.devices),
        })),
    });
}

describe.each(['audio', 'midi'] as const)('a freeze of a %s track whose clips change during the render', (kind) => {
    beforeEach(() => {
        resetProject(kind);
    });

    it('commits the take when nothing changed', async () => {
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        const track = findTrack();
        expect(track.frozen).toBe(true);
        expect(track.freezeState.status).toBe('frozen');
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('commits the take when the track arrays are rebuilt with identical content during the render', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            rebuildTrackArraysWithIdenticalContent();
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack().frozen).toBe(true);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('refuses the take when a clip added during the render is still there at the commit', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            addLateClip(kind);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        const track = findTrack();
        expect(track.frozen).toBe(false);
        expect(track.freezeState.sourceContentHash).toBeUndefined();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('renders the captured clips and commits when a clip is added and removed during the render', async () => {
        let renderedClipIds: string[] = [];
        vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
            addLateClip(kind);
            renderedClipIds = capturedClipIds(options);
            options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
            removeClip(LATE_CLIP_ID);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(renderedClipIds).toEqual(['first-clip']);
        expect(findTrack().frozen).toBe(true);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });
});
