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

import { computeTrackHash } from '../../../services/computeTrackHash';
import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, removeClip, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { cancelFreezeTrack } from '../cancelFreezeTrack';
import { activeFreezeTasks } from '../freezeTrack';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its commit and the clip writes are the real ones over a real CRDT document.
// Only the offline render, which owns the audio, is replaced; like the real one it reads the live
// track list when it is called.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

vi.mock('../../../services/computeTrackHash', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../services/computeTrackHash')>();
    return { computeTrackHash: vi.fn(original.computeTrackHash) };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
}));

const { computeTrackHash: realComputeTrackHash } = await vi.importActual<
    typeof import('../../../services/computeTrackHash')
>('../../../services/computeTrackHash');

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

/** A render that would run despite the edit: it returns a take and removes the late clip again, as a later edit would. */
function renderThenRemoveLateClip(): void {
    vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
        options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
        removeClip(LATE_CLIP_ID);
        return Promise.resolve(renderedBuffer());
    });
}

/** The freeze's own digest finishes with a clip added to the track, as an edit landing meanwhile would. */
function addLateClipDuringFirstDigest(kind: 'audio' | 'midi'): void {
    vi.mocked(computeTrackHash).mockImplementationOnce(async (clips, devices) => {
        const original = await vi.importActual<typeof import('../../../services/computeTrackHash')>(
            '../../../services/computeTrackHash'
        );
        const hash = await original.computeTrackHash(clips, devices);
        addLateClip(kind);
        return hash;
    });
}

/**
 * Runs `afterHash` once the `callNumber`th digest has resolved, counting from the freeze's own:
 * 1 is that digest, 2 the first digest of the check before the render, 3 the next one.
 */
function runAfterDigest(callNumber: number, afterHash: () => void): void {
    let calls = 0;
    vi.mocked(computeTrackHash).mockImplementation(async (clips, devices) => {
        calls += 1;
        const hash = await realComputeTrackHash(clips, devices);
        if (calls === callNumber) {
            afterHash();
        }
        return hash;
    });
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

/**
 * Runs `afterRead` as a microtask queued at the first live track read after the `callNumber`th
 * digest resolves: that is the check's last read, so the write lands in the turns between it and
 * the render.
 */
function runAfterLastLiveRead(callNumber: number, afterRead: () => void): void {
    const readTracks = Object.getOwnPropertyDescriptor(trackStore, 'value')!.get!;
    let armed = false;
    runAfterDigest(callNumber, () => {
        armed = true;
    });
    vi.spyOn(trackStore, 'value', 'get').mockImplementation(() => {
        if (armed) {
            armed = false;
            queueMicrotask(afterRead);
        }
        return readTracks.call(trackStore);
    });
}

beforeEach(() => {
    vi.mocked(computeTrackHash).mockImplementation(realComputeTrackHash);
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze clip added during digest test');
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

describe.each(['audio', 'midi'] as const)(
    'a freeze of a %s track whose clips change while the digest is pending',
    (kind) => {
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

        it('commits the take when the track arrays are rebuilt with identical content during the digest', async () => {
            vi.mocked(computeTrackHash).mockImplementationOnce(async (clips, devices) => {
                const original = await vi.importActual<typeof import('../../../services/computeTrackHash')>(
                    '../../../services/computeTrackHash'
                );
                const hash = await original.computeTrackHash(clips, devices);
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((candidate) => ({
                        ...candidate,
                        clips: structuredClone(candidate.clips),
                        devices: structuredClone(candidate.devices),
                    })),
                });
                return hash;
            });
            vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());

            await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

            expect(findTrack().frozen).toBe(true);
            expect(renderTrackOffline).toHaveBeenCalledTimes(1);
            expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
        });

        it('refuses the take when a clip is added during the digest and removed before the commit', async () => {
            addLateClipDuringFirstDigest(kind);
            renderThenRemoveLateClip();

            await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

            const track = findTrack();
            expect(track.frozen).toBe(false);
            expect(track.frozenBufferId).toBeUndefined();
            expect(track.freezeState.sourceContentHash).toBeUndefined();
            expect(renderTrackOffline).not.toHaveBeenCalled();
            expect(cacheAudioBuffer).not.toHaveBeenCalled();
            expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
        });
    }
);

describe('a freeze whose source check is interrupted', () => {
    beforeEach(() => {
        resetProject('audio');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('refuses the take when a clip lands after the check read the track and before the render', async () => {
        runAfterLastLiveRead(2, () => {
            addLateClip('audio');
        });
        renderThenRemoveLateClip();

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        const track = findTrack();
        expect(track.frozen).toBe(false);
        expect(track.frozenBufferId).toBeUndefined();
        expect(renderTrackOffline).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('does not render when the freeze is cancelled while the check hashes', async () => {
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
        runAfterDigest(2, () => {
            cancelFreezeTrack(TRACK_ID);
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(renderTrackOffline).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(findTrack().frozen).toBe(false);
    });

    it('does not render when another freeze supersedes it while the check hashes', async () => {
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
        runAfterDigest(2, () => {
            activeFreezeTasks.set(TRACK_ID, new AbortController());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        activeFreezeTasks.delete(TRACK_ID);
        expect(renderTrackOffline).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(findTrack().frozen).toBe(false);
    });

    it('commits the take when the arrays are rebuilt with identical content while the check hashes', async () => {
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
        runAfterDigest(2, rebuildTrackArraysWithIdenticalContent);

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack().frozen).toBe(true);
        expect(renderTrackOffline).toHaveBeenCalledTimes(1);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('commits the take when the arrays are rebuilt with identical content while the commit-time check hashes', async () => {
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
        runAfterDigest(3, rebuildTrackArraysWithIdenticalContent);

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack().frozen).toBe(true);
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });
});
