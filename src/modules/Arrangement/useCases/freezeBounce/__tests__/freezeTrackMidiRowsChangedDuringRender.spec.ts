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
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The freeze, its commit and the note handlers are the real ones over a real CRDT document; only
// the offline render, which owns the audio, is replaced, and its await is held open so an edit
// can land inside the window.
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

beforeEach(async () => {
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    vi.mocked(computeTrackHash).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze midi rows changed during render test');
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

    it('accepts a note added through the addNotes action while freezing and refuses the take', async () => {
        await freezeWhile(async () => {
            await executeAppAction(addNotesAction());
        });

        expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.id)).toEqual(['first-note', 'later-note']);
        expect(findTrack().frozen).toBe(false);
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

describe('a freeze whose controller rows change during the render', () => {
    const CC_ROW = { id: 'cc-1', controller: 1, value: 10, beat: 0, channel: 0 };
    const BEND_ROW = { id: 'bend-1', value: 0, beat: 0, channel: 0 };

    beforeEach(() => {
        midiStore.set({
            ...midiStore.value!,
            ccByClipId: { [CLIP_ID]: [CC_ROW] },
            pitchBendByClipId: { [CLIP_ID]: [BEND_ROW] },
        });
    });

    it('commits the take when the controller rows are rewritten unchanged', async () => {
        await freezeWhile(() => {
            const state = midiStore.value!;
            midiStore.set({ ...state, ccByClipId: structuredClone(state.ccByClipId) });
        });

        expect(findTrack().frozen).toBe(true);
    });

    it('refuses the take when a CC row changes while the render is pending', async () => {
        await freezeWhile(() => {
            midiStore.set({ ...midiStore.value!, ccByClipId: { [CLIP_ID]: [{ ...CC_ROW, value: 99 }] } });
        });

        expect(findTrack().frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('refuses the take when a pitch-bend row changes while the render is pending', async () => {
        await freezeWhile(() => {
            midiStore.set({
                ...midiStore.value!,
                pitchBendByClipId: { [CLIP_ID]: [{ ...BEND_ROW, value: 4000 }] },
            });
        });

        expect(findTrack().frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });
});

describe('a freeze whose notes change while the digest is pending', () => {
    it('refuses the take when a note the render read is gone by the commit', async () => {
        const realHash = (
            await vi.importActual<typeof import('../../../services/computeTrackHash')>(
                '../../../services/computeTrackHash'
            )
        ).computeTrackHash;
        const original = midiStore.value!.notesByClipId[CLIP_ID]!;
        vi.mocked(computeTrackHash).mockImplementationOnce(async (clips, devices) => {
            const hash = await realHash(clips, devices);
            const state = midiStore.value!;
            midiStore.set({
                ...state,
                notesByClipId: {
                    [CLIP_ID]: [
                        ...original,
                        { id: 'hash-window-note', pitch: 72, startBeat: 1, duration: 1, velocity: 80 },
                    ],
                },
            });
            return hash;
        });

        const entered = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        let notesTheRenderRead: string[] = [];
        vi.mocked(renderTrackOffline).mockImplementationOnce(async (_track, _start, _end, options) => {
            // The real render reads the MIDI store when it starts, after the digest.
            notesTheRenderRead = (midiStore.value?.notesByClipId[CLIP_ID] ?? []).map((note) => note.id);
            options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
            entered.resolve();
            await resume.promise;
            return renderedBuffer();
        });

        const freezing = executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
        await entered.promise;
        expect(notesTheRenderRead).toEqual(['first-note', 'hash-window-note']);
        midiStore.set({ ...midiStore.value!, notesByClipId: { [CLIP_ID]: original } });
        resume.resolve();
        await freezing;

        expect(findTrack().frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });
});

describe('a row written after the source check resolves', () => {
    it('refuses the take when a CC row lands between the source check and the commit', async () => {
        const realHash = (
            await vi.importActual<typeof import('../../../services/computeTrackHash')>(
                '../../../services/computeTrackHash'
            )
        ).computeTrackHash;
        let hashCalls = 0;
        let sourceCheckResolved = false;
        vi.mocked(computeTrackHash).mockImplementation(async (clips, devices) => {
            hashCalls += 1;
            const hash = await realHash(clips, devices);
            // The first digest is the freeze's own, the second is the check before the render, the
            // third is the commit-time source check's last call.
            sourceCheckResolved = hashCalls === 3;
            return hash;
        });
        // The first project read after the source check resolves is the current-task check that
        // precedes the commit; a row written there lands after every await of the freeze.
        const readProject = Object.getOwnPropertyDescriptor(projectStore, 'value')!.get!;
        const projectRead = vi.spyOn(projectStore, 'value', 'get').mockImplementation(() => {
            if (sourceCheckResolved) {
                sourceCheckResolved = false;
                midiStore.set({
                    ...midiStore.value!,
                    ccByClipId: { [CLIP_ID]: [{ id: 'late-cc', controller: 1, value: 5, beat: 0, channel: 0 }] },
                });
            }
            return readProject.call(projectStore);
        });

        try {
            await freezeWhile(() => undefined);
        } finally {
            projectRead.mockRestore();
            vi.mocked(computeTrackHash).mockImplementation(realHash);
        }

        expect(midiStore.value?.ccByClipId[CLIP_ID]?.map((row) => row.id)).toEqual(['late-cc']);
        expect(findTrack().frozen).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });
});
