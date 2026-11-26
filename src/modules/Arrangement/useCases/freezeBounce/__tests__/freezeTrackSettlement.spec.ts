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
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore, type Track } from '../../../stores';
import { createTrack } from '../../createTrack';
import { addClip, getArrangementHandlers, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { cancelFreezeTrack } from '../cancelFreezeTrack';
import { renderTrackOffline } from '../renderOffline';
import { unfreezeTrack } from '../unfreezeTrack';

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
});

describe('cancelling a freeze', () => {
    it.each<RenderExit>(['resolves', 'rejects'])('settles a freeze cancelled in its render that %s', async (how) => {
        const freeze = startFreeze();
        await freeze.inRender;

        cancelFreezeTrack(TRACK_ID);
        expect(shown()).toEqual(UNFROZEN);
        await exitRender(freeze, how);

        expect(shown()).toEqual(UNFROZEN);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('settles a track that shows freezing with no freeze running', () => {
        rewriteFixtureTrack((track) => ({
            ...track,
            freezeState: { status: 'freezing', renderProgress: 0.4 },
        }));

        cancelFreezeTrack(TRACK_ID);

        expect(shown()).toEqual(UNFROZEN);
    });

    it('keeps the stale take a cancelled refresh was replacing', async () => {
        makeTakeStale();
        const freeze = startFreeze();
        await freeze.inRender;
        expect(shown().status).toBe('freezing');

        cancelFreezeTrack(TRACK_ID);
        await exitRender(freeze, 'resolves');

        expect(shown()).toEqual(STALE_TAKE);
    });
});

describe('a freeze that supersedes a running one', () => {
    it.each<{ first: RenderExit; order: 'first exits first' | 'second exits first' }>([
        { first: 'resolves', order: 'first exits first' },
        { first: 'rejects', order: 'first exits first' },
        { first: 'resolves', order: 'second exits first' },
        { first: 'rejects', order: 'second exits first' },
    ])('restores the original state when cancelled ($order, first render $first)', async ({ first, order }) => {
        const a = startFreeze();
        await a.inRender;
        const b = startFreeze();
        await b.inRender;

        cancelFreezeTrack(TRACK_ID);
        if (order === 'first exits first') {
            await exitRender(a, first);
            await exitRender(b, 'resolves');
        } else {
            await exitRender(b, 'resolves');
            await exitRender(a, first);
        }

        expect(shown()).toEqual(UNFROZEN);
    });

    it('restores the stale take, not freezing, when the refresh that superseded another is cancelled', async () => {
        makeTakeStale();
        const a = startFreeze();
        await a.inRender;
        const b = startFreeze();
        await b.inRender;

        cancelFreezeTrack(TRACK_ID);
        await exitRender(a, 'rejects');
        await exitRender(b, 'rejects');

        expect(shown()).toEqual(STALE_TAKE);
    });

    it('restores the error a failed freeze left when the freeze that superseded another is cancelled', async () => {
        const failed = startFreeze();
        await failed.inRender;
        await exitRender(failed, 'rejects');
        expect(shown().status).toBe('error');
        const a = startFreeze();
        await a.inRender;
        const b = startFreeze();
        await b.inRender;

        cancelFreezeTrack(TRACK_ID);
        await exitRender(a, 'resolves');
        await exitRender(b, 'resolves');

        expect(shown().status).toBe('error');
        expect(findTrack().freezeState.errorMessage).toBe('Render crashed');
    });

    it('restores the original state when the superseding freeze fails', async () => {
        const a = startFreeze();
        await a.inRender;
        const b = startFreeze();
        await b.inRender;

        await exitRender(a, 'resolves');
        expect(shown().status).toBe('freezing');
        await exitRender(b, 'rejects');

        expect(shown().status).toBe('error');
        expect(findTrack().freezeState.errorMessage).toBe('Render crashed');
        expect(findTrack().frozen).toBe(false);
    });
});

describe('a freeze started right after a cancel', () => {
    it.each<{ order: 'first exits first' | 'second exits first' }>([
        { order: 'first exits first' },
        { order: 'second exits first' },
    ])('restores the original state when cancelled again ($order)', async ({ order }) => {
        const a = startFreeze();
        await a.inRender;
        cancelFreezeTrack(TRACK_ID);
        const b = startFreeze();
        await b.inRender;

        cancelFreezeTrack(TRACK_ID);
        if (order === 'first exits first') {
            await exitRender(a, 'resolves');
            await exitRender(b, 'rejects');
        } else {
            await exitRender(b, 'rejects');
            await exitRender(a, 'resolves');
        }

        expect(shown()).toEqual(UNFROZEN);
    });

    it('lets the cancelled freeze exit without disturbing the freeze that replaced it', async () => {
        const a = startFreeze();
        await a.inRender;
        cancelFreezeTrack(TRACK_ID);
        const b = startFreeze();
        await b.inRender;

        await exitRender(a, 'rejects');
        expect(shown().status).toBe('freezing');
        await exitRender(b, 'resolves');

        expect(shown().status).toBe('frozen');
    });

    it('keeps the replacement freeze’s failure when the cancelled freeze settles late', async () => {
        const a = startFreeze();
        await a.inRender;
        cancelFreezeTrack(TRACK_ID);
        const b = startFreeze();
        await b.inRender;
        await exitRender(b, 'rejects');
        expect(shown().status).toBe('error');

        await exitRender(a, 'rejects');

        expect(shown().status).toBe('error');
        expect(findTrack().freezeState.errorMessage).toBe('Render crashed');
    });

    it.each<RenderExit>(['resolves', 'rejects'])(
        'does not bring a cancelled take back after the replacement committed and was unfrozen (%s)',
        async (how) => {
            const a = startFreeze();
            await a.inRender;
            cancelFreezeTrack(TRACK_ID);
            const b = startFreeze();
            await b.inRender;
            await exitRender(b, 'resolves');
            expect(shown().status).toBe('frozen');
            unfreezeTrack(TRACK_ID);

            await exitRender(a, how);

            expect(shown()).toEqual(UNFROZEN);
        }
    );
});

describe('a freeze that fails', () => {
    it('records the failure on a stale refresh and keeps its take', async () => {
        makeTakeStale();
        const freeze = startFreeze();
        await freeze.inRender;

        await exitRender(freeze, 'rejects');

        expect(shown()).toEqual({ ...STALE_TAKE, status: 'error' });
    });

    it('does not leave freezing when the project changed during the render so the diagnostic is refused', async () => {
        const freeze = startFreeze();
        await freeze.inRender;
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => (track.id === 'track-2' ? { ...track, gain: 0.5 } : track)),
        });
        flushAutomergeStorageWrites();

        await exitRender(freeze, 'rejects');

        expect(shown()).toEqual(UNFROZEN);
    });
});
