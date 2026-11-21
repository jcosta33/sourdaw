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
import { sidechainStore } from '#/modules/Routing/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Track } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, removeClip, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { initStalenessDetection } from '../initStalenessDetection';
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
const SOURCE_ID = 'track-source';
const OTHER_ID = 'track-other';
const CHANGED_MESSAGE = 'The track changed while it was freezing. Freeze it again.';

function findTrack(trackId: string) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected the fixture track ${trackId}`);
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

/** The frozen track, a source routed into it, and a track that reaches it by no route. */
function resetProject(sourceKind: 'audio' | 'midi' = 'audio'): void {
    trackStore.set({
        tracks: [
            createTrack({ id: TRACK_ID, name: 'Frozen', kind: 'audio' }),
            { ...createTrack({ id: SOURCE_ID, name: 'Source', kind: sourceKind }), outputId: TRACK_ID },
            createTrack({ id: OTHER_ID, name: 'Other', kind: 'audio' }),
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
    addClip({ id: 'first-clip', trackId: TRACK_ID, startBeat: 0, endBeat: 4, name: 'First', type: 'audio' });
    addClip({ id: 'source-clip', trackId: SOURCE_ID, startBeat: 0, endBeat: 4, name: 'Source', type: sourceKind });
}

function addLateClip(trackId: string, clipId = 'late-clip'): void {
    addClip({ id: clipId, trackId, startBeat: 4, endBeat: 8, name: 'Late', type: 'audio' });
}

async function freeze(): Promise<void> {
    vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer());
    await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
}

beforeEach(() => {
    vi.mocked(computeTrackHash).mockImplementation(realComputeTrackHash);
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze routed sources test');
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
    resetProject();
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

describe('a freeze whose render reads a routed source track', () => {
    it('refuses the take when the source gains a clip during the digest and loses it before the commit', async () => {
        vi.mocked(computeTrackHash).mockImplementationOnce(async (clips, devices) => {
            const hash = await realComputeTrackHash(clips, devices);
            addLateClip(SOURCE_ID);
            return hash;
        });
        vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
            options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
            removeClip('late-clip');
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        const track = findTrack(TRACK_ID);
        expect(track.frozen).toBe(false);
        expect(track.freezeState.sourceContentHash).toBeUndefined();
        expect(renderTrackOffline).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('refuses the take when the source is edited during the render', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            addLateClip(SOURCE_ID);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it.each([
        ["a routed source's gain changes", (track: Track) => ({ ...track, gain: 0.3 })],
        ["a routed source's pan changes", (track: Track) => ({ ...track, pan: -0.5 })],
        ['a routed source is muted', (track: Track) => ({ ...track, muted: true })],
        [
            'a routed source gains a send',
            (track: Track) => ({ ...track, sends: [{ busId: TRACK_ID, level: 0.5, preFader: false }] }),
        ],
        [
            "a routed source's output moves to another track the render reads",
            (track: Track) => ({ ...track, outputId: OTHER_ID }),
        ],
    ])('refuses the take when %s during the render', async (_name, edit) => {
        updateTrack(OTHER_ID, (track) => ({ ...track, outputId: TRACK_ID }));
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(SOURCE_ID, edit);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('refuses the take when a routed source changes a send level during the render', async () => {
        updateTrack(SOURCE_ID, (track) => ({ ...track, sends: [{ busId: TRACK_ID, level: 0.8, preFader: false }] }));
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.2, preFader: false }],
            }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it("commits the take when the target's own fader moves during the render", async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            updateTrack(TRACK_ID, (track) => ({ ...track, gain: 0.3 }));
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it('refuses the take when a routed MIDI source has a note edited during the render', async () => {
        resetProject('midi');
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'source-clip': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
        });
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    ...midiStore.value!.notesByClipId,
                    'source-clip': [{ id: 'note-1', pitch: 62, startBeat: 0, duration: 1, velocity: 90 }],
                },
            });
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('commits the take when only a track outside the render is edited during the render', async () => {
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            addLateClip(OTHER_ID);
            return Promise.resolve(renderedBuffer());
        });

        await executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });

        expect(findTrack(TRACK_ID).frozen).toBe(true);
    });

    it('gives the same signature to the same sources twice', async () => {
        await freeze();
        const first = findTrack(TRACK_ID).freezeState.sourceContentHash;
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: TRACK_ID } });
        await freeze();

        expect(first).toBeDefined();
        expect(findTrack(TRACK_ID).freezeState.sourceContentHash).toBe(first);
    });

    describe('once frozen', () => {
        let stopStaleness: () => void;

        beforeEach(async () => {
            await freeze();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            stopStaleness = initStalenessDetection();
        });

        afterEach(() => {
            stopStaleness();
        });

        it('marks the track stale when a routed source is edited', async () => {
            addLateClip(SOURCE_ID);

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('keeps the freeze when a track outside the render is edited', async () => {
            vi.mocked(computeTrackHash).mockClear();

            addLateClip(OTHER_ID);

            expect(computeTrackHash).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');

            addLateClip(SOURCE_ID, 'source-late-clip');

            expect(computeTrackHash).toHaveBeenCalled();
        });

        it('marks the track stale when the source is rerouted away', async () => {
            updateTrack(SOURCE_ID, (track) => ({ ...track, outputId: 'master' }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });
    });
    describe('once frozen over extra routing', () => {
        let stopStaleness: () => void;

        afterEach(() => {
            stopStaleness();
        });

        async function freezeWatched(): Promise<void> {
            await freeze();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
            stopStaleness = initStalenessDetection();
        }

        it('marks the track stale when a routed source changes its gain', async () => {
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({ ...track, gain: 0.3 }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a routed source changes a send level', async () => {
            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.8, preFader: false }],
            }));
            await freezeWatched();

            updateTrack(SOURCE_ID, (track) => ({
                ...track,
                sends: [{ busId: TRACK_ID, level: 0.2, preFader: false }],
            }));

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('marks the track stale when a sidechain route into the render is removed', async () => {
            sidechainStore.set({
                routes: [
                    {
                        id: 'route-1',
                        sourceTrackId: OTHER_ID,
                        targetTrackId: TRACK_ID,
                        targetDeviceId: 'device-1',
                        targetParameterId: 'key',
                        gain: 1,
                    },
                ],
            });
            await freezeWatched();

            sidechainStore.set({ routes: [] });

            await vi.waitFor(() => {
                expect(findTrack(TRACK_ID).freezeState.status).toBe('stale');
            });
        });

        it('keeps the freeze when a sidechain route between unrelated tracks changes', async () => {
            await freezeWatched();
            vi.mocked(computeTrackHash).mockClear();

            sidechainStore.set({
                routes: [
                    {
                        id: 'route-2',
                        sourceTrackId: OTHER_ID,
                        targetTrackId: 'track-nowhere',
                        targetDeviceId: 'device-1',
                        targetParameterId: 'key',
                        gain: 1,
                    },
                ],
            });

            expect(computeTrackHash).not.toHaveBeenCalled();
            expect(findTrack(TRACK_ID).freezeState.status).toBe('frozen');
        });
    });
});
