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
import { addMidiNote, getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
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
import { addClip, getArrangementHandlers, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { cancelFreezeTrack } from '../cancelFreezeTrack';
import { freezeTrack } from '../freezeTrack';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The freeze, its commit and the note handlers are the real ones over a real CRDT document; only
// the offline render, which owns the audio, is replaced, and its await is held open so an edit,
// a cancel or a second freeze can land inside the window.
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

const TRACK_ID = 'midi-track-1';
const CLIP_ID = 'midi-clip-1';
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

type HeldRender = { entered: Promise<void>; release: () => void };

/** The next render reports a scheduled note, stays pending until released, then succeeds. */
function holdNextRender(): HeldRender {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    vi.mocked(renderTrackOffline).mockImplementationOnce(async (_track, _start, _end, options) => {
        options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
        entered.resolve();
        await resume.promise;
        return renderedBuffer();
    });
    return { entered: entered.promise, release: () => resume.resolve() };
}

/** Freezes the track, runs `duringRender` while the render is awaiting, then lets the render succeed. */
async function freezeWhile(duringRender: () => void | Promise<void>): Promise<void> {
    const render = holdNextRender();
    const freezing = executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
    await render.entered;
    expect(findTrack().freezeState.status).toBe('freezing');
    await duringRender();
    render.release();
    await freezing;
}

function addNotesAction() {
    return {
        type: 'addNotes' as const,
        payload: { clipId: CLIP_ID, notes: [{ id: 'later-note', pitch: 64, startBeat: 2, duration: 1, velocity: 90 }] },
    };
}

function expectSettledUnfrozen(): void {
    const track = findTrack();
    expect(track.frozen).toBe(false);
    expect(track.freezeState.status).toBe('unfrozen');
    expect(track.frozenBufferId).toBeUndefined();
}

beforeEach(async () => {
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    vi.mocked(computeTrackHash).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze midi notes and cancel test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    registerHandlerMap(getMidiNoteTransformHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    projectStore.set(structuredClone(defaultProjectStoreState));
    trackStore.set({
        tracks: [createTrack({ id: TRACK_ID, name: 'Keys', kind: 'midi' })],
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
    addClip({ id: CLIP_ID, trackId: TRACK_ID, startBeat: 0, endBeat: 4, name: 'Phrase', type: 'midi' });
    midiStore.set({
        ...midiStore.value!,
        notesByClipId: { [CLIP_ID]: [{ id: 'first-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
    });
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

describe('a freeze whose MIDI notes change during the render', () => {
    it('commits the take when no note changed during the render', async () => {
        await freezeWhile(() => undefined);

        const track = findTrack();
        expect(track.frozen).toBe(true);
        expect(track.freezeState.status).toBe('frozen');
        expect(cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('commits the take when a note write rewrites the same notes', async () => {
        await freezeWhile(() => {
            const state = midiStore.value!;
            midiStore.set({
                ...state,
                notesByClipId: { [CLIP_ID]: structuredClone(state.notesByClipId[CLIP_ID]!) },
            });
        });

        expect(findTrack().frozen).toBe(true);
    });

    it('refuses the take when a note is added straight to the store while the render is pending', async () => {
        await freezeWhile(() => {
            addMidiNote(CLIP_ID, 67, 2, 1);
        });

        const track = findTrack();
        expect(track.frozen).toBe(false);
        expect(track.frozenBufferId).toBeUndefined();
        expect(track.freezeState.sourceContentHash).toBeUndefined();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('refuses the take when a note is edited in place while the render is pending', async () => {
        await freezeWhile(() => {
            const state = midiStore.value!;
            midiStore.set({
                ...state,
                notesByClipId: {
                    [CLIP_ID]: state.notesByClipId[CLIP_ID]!.map((note) => ({ ...note, velocity: 12 })),
                },
            });
        });

        expect(findTrack().frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });
});

describe('a cancelled freeze', () => {
    it('settles the track when it is cancelled while the digest is pending', async () => {
        const realHash = (
            await vi.importActual<typeof import('../../../services/computeTrackHash')>(
                '../../../services/computeTrackHash'
            )
        ).computeTrackHash;
        vi.mocked(computeTrackHash).mockImplementationOnce(async (clips, devices) => {
            const hash = await realHash(clips, devices);
            cancelFreezeTrack(TRACK_ID);
            return hash;
        });

        // Called directly, not as the action: the action's own transaction would mask whether the
        // freeze settles the track itself.
        await freezeTrack(TRACK_ID);

        expectSettledUnfrozen();
        expect(renderTrackOffline).not.toHaveBeenCalled();
        await executeAppAction(addNotesAction());
        expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.id)).toEqual(['first-note', 'later-note']);
    });

    it('settles the track when it is cancelled while the render is pending', async () => {
        const render = holdNextRender();
        const freezing = freezeTrack(TRACK_ID);
        await render.entered;
        expect(findTrack().freezeState.status).toBe('freezing');
        cancelFreezeTrack(TRACK_ID);
        render.release();
        await freezing;

        expectSettledUnfrozen();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        await executeAppAction(addNotesAction());
        expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.id)).toEqual(['first-note', 'later-note']);
    });

    it('leaves a freeze that superseded it in charge of the track', async () => {
        const first = holdNextRender();
        const firstFreeze = freezeTrack(TRACK_ID);
        await first.entered;

        const second = holdNextRender();
        const secondFreeze = freezeTrack(TRACK_ID);
        await second.entered;

        first.release();
        await firstFreeze;
        expect(findTrack().freezeState.status).toBe('freezing');
        expect(findTrack().frozen).toBe(false);

        second.release();
        await secondFreeze;
        expect(findTrack().frozen).toBe(true);
        expect(findTrack().freezeState.status).toBe('frozen');
    });
});
