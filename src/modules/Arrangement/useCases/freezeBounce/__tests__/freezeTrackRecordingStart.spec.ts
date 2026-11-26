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
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { defaultTransportState, recordingStartStore, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore, type Track } from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its transaction and the settlement writes are the real ones over a real CRDT
// document. Only the offline render, which owns the audio, is replaced; each test gates it so a
// freeze can be cancelled, superseded or finished at a chosen point.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
}));

const TRACK_ID = 'track-1';

function findTrack() {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('Expected the fixture track');
    }
    return track;
}

/** What the UI reads: the status, and the take the track points at. */
function shown() {
    const track = findTrack();
    return { frozen: track.frozen, frozenBufferId: track.frozenBufferId, status: track.freezeState.status };
}

const UNFROZEN = { frozen: false, frozenBufferId: undefined, status: 'unfrozen' };

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

type GatedFreeze = {
    /** Resolves once the freeze action has exited. */
    exited: Promise<unknown>;
    /** Resolves once the freeze is waiting inside its render. */
    inRender: Promise<void>;
    finishRender: () => void;
    failRender: () => void;
};

/** Starts a `freezeTrack` action whose render waits until the test finishes or fails it. */
function startFreeze(): GatedFreeze {
    const entered = Promise.withResolvers<void>();
    const render = Promise.withResolvers<AudioBuffer>();
    vi.mocked(renderTrackOffline).mockImplementationOnce(() => {
        entered.resolve();
        return render.promise;
    });
    const exited = executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } }).then(
        () => undefined,
        (error: unknown) => error
    );
    return {
        exited,
        inRender: entered.promise,
        finishRender: () => {
            render.resolve(renderedBuffer());
        },
        failRender: () => {
            render.reject(new Error('Render crashed'));
        },
    };
}

type RenderExit = 'resolves' | 'rejects';

async function exitRender(freeze: GatedFreeze, how: RenderExit): Promise<void> {
    if (how === 'resolves') {
        freeze.finishRender();
    } else {
        freeze.failRender();
    }
    await freeze.exited;
}

function resetProject(): void {
    trackStore.set({
        tracks: [
            createTrack({ id: TRACK_ID, name: 'Source', kind: 'audio' }),
            createTrack({ id: 'track-2', name: 'Other', kind: 'audio' }),
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
    flushAutomergeStorageWrites();
}

function rewriteFixtureTrack(rewrite: (track: Track) => Track): void {
    const state = trackStore.value!;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== TRACK_ID) {
                return track;
            }
            return rewrite(track);
        }),
    });
}

/** A frozen take that went stale, the state a refresh starts from. */
function makeTakeStale(): void {
    rewriteFixtureTrack((track) => ({
        ...track,
        frozen: true,
        frozenBufferId: 'old-take',
        freezeState: {
            status: 'stale',
            freezeId: 'old-take',
            frozenBufferId: 'old-take',
            sourceContentHash: 'old-hash',
        },
    }));
    flushAutomergeStorageWrites();
}

const STALE_TAKE = { frozen: true, frozenBufferId: 'old-take', status: 'stale' };

beforeEach(() => {
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze settlement test');
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
    vi.restoreAllMocks();
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    transportStore.set(defaultTransportState);
    recordingStartStore.set(false);
});

const WARNING = 'Freeze is unavailable while this track is recording.';

function armFixtureTrack(): void {
    rewriteFixtureTrack((track) => ({ ...track, armed: true }));
    flushAutomergeStorageWrites();
}

describe('a freeze whose track starts recording while it renders', () => {
    it.each([
        { name: 'a count-in', engage: () => recordingStartStore.set(true) },
        {
            name: 'a running take',
            engage: () => {
                // The take's provisional clip lands on the track, so its source no longer hashes as rendered.
                addClip({
                    id: 'take-clip',
                    trackId: TRACK_ID,
                    startBeat: 4,
                    endBeat: 8,
                    name: 'Recording',
                    type: 'audio',
                });
                flushAutomergeStorageWrites();
                transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });
            },
        },
    ])('refuses the commit during $name and leaves the track unfrozen', async ({ engage }) => {
        armFixtureTrack();
        const freeze = startFreeze();
        await freeze.inRender;
        expect(shown().status).toBe('freezing');

        engage();
        await exitRender(freeze, 'resolves');

        expect(shown()).toEqual(UNFROZEN);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(WARNING, 'warning');
    });

    it('settles back to the stale take a refresh was replacing', async () => {
        makeTakeStale();
        armFixtureTrack();
        const freeze = startFreeze();
        await freeze.inRender;

        recordingStartStore.set(true);
        await exitRender(freeze, 'resolves');

        expect(shown()).toEqual(STALE_TAKE);
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('still commits an armed track while no recording is engaged', async () => {
        armFixtureTrack();
        const freeze = startFreeze();
        await freeze.inRender;

        await exitRender(freeze, 'resolves');

        expect(shown().status).toBe('frozen');
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('still commits an unarmed track while a recording starts', async () => {
        const freeze = startFreeze();
        await freeze.inRender;

        recordingStartStore.set(true);
        await exitRender(freeze, 'resolves');

        expect(shown().status).toBe('frozen');
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
