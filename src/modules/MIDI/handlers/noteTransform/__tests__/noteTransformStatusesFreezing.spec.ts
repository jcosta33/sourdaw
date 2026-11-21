import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type MidiClipNoteSnapshot } from '../../../events/midiClipDataSnapshots';
import { midiStore } from '../../../stores/midiStore';
import { getCopyMidiArticulationsStatus } from '../../../useCases/midiNoteTransforms/getCopyMidiArticulationsStatus';
import { getRemoveShortMidiOverlapsStatus } from '../../../useCases/midiNoteTransforms/getRemoveShortMidiOverlapsStatus';
import { getRestoreMidiClipNotesStatus } from '../../../useCases/midiNoteTransforms/getRestoreMidiClipNotesStatus';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';

const TRACK_ID = 'track-1';
const CLIP_ID = 'clip-1';
const OTHER_CLIP_ID = 'clip-2';
const TEMPO = 120;

const notes: MidiClipNoteSnapshot[] = [
    { id: 'note-a', pitch: 60, startBeat: 0, duration: 1.04, velocity: 100, channel: 0 },
    { id: 'note-b', pitch: 60, startBeat: 1, duration: 1, velocity: 96, channel: 0 },
];

// A freeze that has started but not committed: `frozen` is still false.
function setFreezeState(freezeState: { status: 'unfrozen' | 'freezing' }): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: trackStore.value!.tracks.map((track) => ({ ...track, frozen: false, freezeState })),
    });
}

function restoreAction(): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    return {
        type: 'restoreMidiClipNotes',
        payload: {
            clipId: CLIP_ID,
            notes,
            expectedNotes: notes,
            noteTransformReplayGuard: {
                trackId: TRACK_ID,
                expectedTrackFrozen: false,
                expectedClipLocked: false,
            },
        },
    };
}

beforeEach(() => {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'MIDI' })],
    });
    for (const id of [CLIP_ID, OTHER_CLIP_ID]) {
        addClip({ id, trackId: TRACK_ID, startBeat: 0, endBeat: 8, name: id, type: 'midi' });
    }
    transportStore.set({ ...defaultTransportState, tempo: TEMPO });
    midiStore.set({
        notesByClipId: {
            [CLIP_ID]: structuredClone(notes),
            [OTHER_CLIP_ID]: structuredClone(notes),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
});

describe('note transform replay guards on a track that is freezing', () => {
    describe('getRemoveShortMidiOverlapsStatus', () => {
        const input = {
            clipId: CLIP_ID,
            maximumOverlapMs: 30,
            expectedTempo: TEMPO,
            expectedTrackId: TRACK_ID,
            trackName: 'MIDI',
            expectedTrackFrozen: false,
            clipName: CLIP_ID,
            expectedClipLocked: false,
            expectedNotes: notes,
        };

        it('admits the idle unfrozen track', () => {
            setFreezeState({ status: 'unfrozen' });

            expect(getRemoveShortMidiOverlapsStatus(input)).toBe('written');
        });

        it('refuses a freezing track whose frozen flag is still false', () => {
            setFreezeState({ status: 'freezing' });

            expect(getRemoveShortMidiOverlapsStatus(input)).toBe('conflict');
        });
    });

    describe('getCopyMidiArticulationsStatus', () => {
        const sourceNotes: MidiClipNoteSnapshot[] = notes.map((note) => ({
            ...note,
            articulation: 'staccato',
        }));
        const input = {
            trackId: TRACK_ID,
            sourceClipId: CLIP_ID,
            targetClipId: OTHER_CLIP_ID,
            notePairs: [
                { sourceNoteId: 'note-a', targetNoteId: 'note-a' },
                { sourceNoteId: 'note-b', targetNoteId: 'note-b' },
            ],
            expectedSourceNotes: sourceNotes,
            expectedTargetNotes: notes,
            expectedTrackFrozen: false,
            expectedSourceClipLocked: false,
            expectedTargetClipLocked: false,
        };

        it('admits the idle unfrozen track', () => {
            setFreezeState({ status: 'unfrozen' });
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    [CLIP_ID]: structuredClone(sourceNotes),
                    [OTHER_CLIP_ID]: structuredClone(notes),
                },
            });

            expect(getCopyMidiArticulationsStatus(input)).toBe('written');
        });

        it('refuses a freezing track whose frozen flag is still false', () => {
            setFreezeState({ status: 'freezing' });
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    [CLIP_ID]: structuredClone(sourceNotes),
                    [OTHER_CLIP_ID]: structuredClone(notes),
                },
            });

            expect(getCopyMidiArticulationsStatus(input)).toBe('conflict');
        });
    });

    describe('getRestoreMidiClipNotesStatus', () => {
        const articulationInput = {
            clipId: OTHER_CLIP_ID,
            notes,
            expectedNotes: notes,
            articulationReplayGuard: {
                trackId: TRACK_ID,
                sourceClipId: CLIP_ID,
                expectedSourceNotes: notes,
                expectedTrackFrozen: false,
                expectedSourceClipLocked: false,
                expectedTargetClipLocked: false,
            },
        };

        it('admits an articulation replay on the idle unfrozen track', () => {
            setFreezeState({ status: 'unfrozen' });

            expect(getRestoreMidiClipNotesStatus(articulationInput)).not.toBe('conflict');
        });

        it('refuses an articulation replay on a freezing track', () => {
            setFreezeState({ status: 'freezing' });

            expect(getRestoreMidiClipNotesStatus(articulationInput)).toBe('conflict');
        });

        it('admits a note transform replay on the idle unfrozen track', () => {
            setFreezeState({ status: 'unfrozen' });

            expect(getRestoreMidiClipNotesStatus(restoreAction().payload)).not.toBe('conflict');
        });

        it('refuses a note transform replay on a freezing track', () => {
            setFreezeState({ status: 'freezing' });

            expect(getRestoreMidiClipNotesStatus(restoreAction().payload)).toBe('conflict');
        });
    });

    describe('handleRestoreMidiClipNotes projected target', () => {
        // The clip the restore addresses is produced earlier in the same batch, so the replay
        // target is projected from the live track the producer will land on.
        function validatesAfterClipProducer(): boolean | undefined {
            const producer: AppAction = {
                type: 'addClip',
                payload: {
                    id: 'clip-produced',
                    trackId: TRACK_ID,
                    startBeat: 0,
                    endBeat: 8,
                    name: 'Produced',
                    type: 'midi',
                },
            };
            const restore: Extract<AppAction, { type: 'restoreMidiClipNotes' }> = {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: 'clip-produced',
                    notes: [],
                    expectedNotes: [],
                    notesBucketPresent: false,
                    expectedNotesBucketPresent: false,
                    allowMissingExpectedEmpty: true,
                    noteTransformReplayGuard: {
                        trackId: TRACK_ID,
                        expectedTrackFrozen: false,
                        expectedClipLocked: false,
                    },
                },
            };
            return handleRestoreMidiClipNotes.validate?.(restore, { actions: [producer, restore], actionIndex: 1 });
        }

        it('admits the idle unfrozen track', () => {
            setFreezeState({ status: 'unfrozen' });

            expect(validatesAfterClipProducer()).toBe(true);
        });

        it('refuses a freezing track whose frozen flag is still false', () => {
            setFreezeState({ status: 'freezing' });

            expect(validatesAfterClipProducer()).toBe(false);
        });
    });
});
