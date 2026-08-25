import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../../stores/midiStore';
import { getMidiNoteTransformHandlers } from '../../../useCases/getMidiNoteTransformHandlers';
import { handleRemoveShortMidiOverlaps } from '../handleRemoveShortMidiOverlaps';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';

const CLIP_ID = 'clip-piano';
const TRACK_ID = 'track-piano';
const TEMPO = 120;

const expectedNotes: readonly MidiClipNoteSnapshot[] = [
    { id: 'overlap-a', pitch: 60, startBeat: 0, duration: 1.04, velocity: 100, channel: 0 },
    { id: 'overlap-b', pitch: 60, startBeat: 1, duration: 1, velocity: 96, channel: 0 },
];

const action: Extract<AppAction, { type: 'removeShortMidiOverlaps' }> = {
    type: 'removeShortMidiOverlaps',
    payload: {
        clipId: CLIP_ID,
        maximumOverlapMs: 30,
        expectedTempo: TEMPO,
        expectedTrackId: TRACK_ID,
        trackName: 'Piano',
        expectedTrackFrozen: false,
        clipName: 'Piano Phrase',
        expectedClipLocked: false,
        expectedNotes,
    },
};

function requireRestoreAction(
    candidate: AppAction | null | undefined
): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    if (candidate?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes inverse');
    }
    return candidate;
}

function resetGuardedPostState(inverse: Extract<AppAction, { type: 'restoreMidiClipNotes' }>): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'Piano' })],
    });
    if (
        addClip({
            id: CLIP_ID,
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            name: 'Piano Phrase',
            type: 'midi',
        }) === null
    ) {
        throw new Error('Expected MIDI clip fixture');
    }
    transportStore.set({ ...defaultTransportState, tempo: TEMPO });
    midiStore.set({
        notesByClipId: { [CLIP_ID]: inverse.payload.expectedNotes.map((note) => ({ ...note })) },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function validates(inverse: Extract<AppAction, { type: 'restoreMidiClipNotes' }>): boolean | undefined {
    return handleRestoreMidiClipNotes.validate?.(inverse, { actions: [inverse], actionIndex: 0 });
}

describe('handleRemoveShortMidiOverlaps', () => {
    let inverse: Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        inverse = requireRestoreAction(handleRemoveShortMidiOverlaps.describe(action).inverseAction);
        resetGuardedPostState(inverse);
    });

    afterEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('is admitted and committed by the atomic batch executor', async () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { [CLIP_ID]: expectedNotes.map((note) => ({ ...note })) },
        });

        const result = await executeAppActionBatch([action], { requireCompensation: true });

        expect(result).toMatchObject({
            status: 'committed',
            actions: [{ action: { type: 'removeShortMidiOverlaps' } }],
        });
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(inverse.payload.expectedNotes);
    });

    it('declares its exact guarded inverse admissible for atomic compensation', () => {
        expect(inverse.payload.noteTransformReplayGuard).toEqual({
            trackId: TRACK_ID,
            expectedTrackFrozen: false,
            expectedClipLocked: false,
            expectedTempo: TEMPO,
        });
        expect(handleRestoreMidiClipNotes.canReapplyAfterDivergence?.(inverse)).toBe(true);

        const unguarded = structuredClone(inverse);
        delete unguarded.payload.noteTransformReplayGuard;
        expect(handleRestoreMidiClipNotes.canReapplyAfterDivergence?.(unguarded)).toBe(false);
    });

    it('rejects compensation after exact notes or eligibility state diverges', () => {
        expect(validates(inverse)).toBe(true);

        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                [CLIP_ID]: [...inverse.payload.expectedNotes, { ...expectedNotes[0]!, id: 'collaborator-note' }],
            },
        });
        expect(validates(inverse)).toBe(false);

        resetGuardedPostState(inverse);
        transportStore.set({ ...defaultTransportState, tempo: 90 });
        expect(validates(inverse)).toBe(false);

        resetGuardedPostState(inverse);
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: true })),
        });
        expect(validates(inverse)).toBe(false);

        resetGuardedPostState(inverse);
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, locked: true })),
            })),
        });
        expect(validates(inverse)).toBe(false);
    });
});
