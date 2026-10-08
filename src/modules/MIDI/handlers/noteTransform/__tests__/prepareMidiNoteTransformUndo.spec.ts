import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';

vi.mock('../../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot', () => ({
    getMidiClipNotesSnapshot: vi.fn(),
}));

import { getMidiClipNotesSnapshot } from '../../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';
import { prepareMidiNoteTransformUndo } from '../prepareMidiNoteTransformUndo';

const mockedSnapshot = vi.mocked(getMidiClipNotesSnapshot);
const TRACK_ID = 'track-1';
const CLIP_ID = 'c1';

import type { MidiNote } from '../../../models/MidiNote';

function makeNote(overrides: Partial<MidiNote> = {}): MidiNote {
    return {
        id: 'n1',
        pitch: 60,
        startBeat: 0,
        duration: 1,
        velocity: 100,
        probability: 100,
        pressure: 0,
        slide: 0,
        pitchBend: 0,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'MIDI' })],
    });
    if (
        addClip({
            id: CLIP_ID,
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 4,
            name: 'MIDI clip',
            type: 'midi',
        }) === null
    ) {
        throw new Error('Expected MIDI clip fixture');
    }
});

describe('prepareMidiNoteTransformUndo — noop cases', () => {
    it('returns isNoop=true when snapshot is null', () => {
        mockedSnapshot.mockReturnValue(null);
        const result = prepareMidiNoteTransformUndo({ clipId: 'c1', label: 'Test', transform: () => [] });
        expect(result.isNoop).toBe(true);
        expect(result.description.label).toBe('Test');
        expect(result.description.inverseAction).toBeUndefined();
    });

    it('returns isNoop=true when notes are empty', () => {
        mockedSnapshot.mockReturnValue([]);
        const result = prepareMidiNoteTransformUndo({ clipId: 'c1', label: 'Test', transform: () => [] });
        expect(result.isNoop).toBe(true);
    });

    it('returns isNoop=true when transform produces identical notes', () => {
        const notes = [makeNote()];
        mockedSnapshot.mockReturnValue(notes);
        const result = prepareMidiNoteTransformUndo({ clipId: 'c1', label: 'Test', transform: (notes) => [...notes] });
        expect(result.isNoop).toBe(true);
    });
});

describe('prepareMidiNoteTransformUndo — with changes', () => {
    it('returns isNoop=false and inverse restoreMidiClipNotes', () => {
        const notes = [makeNote()];
        mockedSnapshot.mockReturnValue(notes);
        const result = prepareMidiNoteTransformUndo({
            clipId: 'c1',
            label: 'Quantize',
            transform: () => [makeNote({ startBeat: 0.5 })],
        });
        expect(result.isNoop).toBe(false);
        expect(result.description.label).toBe('Quantize');
        expect(result.description.inverseAction?.type).toBe('restoreMidiClipNotes');
        const invPayload = (
            result.description.inverseAction as unknown as {
                payload: { clipId: string; notes: MidiNote[]; expectedNotes: MidiNote[] };
            }
        ).payload;
        expect(invPayload.clipId).toBe(CLIP_ID);
        // Inverse: notes = original (for restore), expectedNotes = original (what was there before transform)
        expect(invPayload.notes).toEqual(notes);
        expect(result.description.inverseAction).toMatchObject({
            payload: {
                noteTransformReplayGuard: {
                    trackId: TRACK_ID,
                    expectedTrackFrozen: false,
                    expectedClipLocked: false,
                },
            },
        });
    });

    it('returns redo restoreMidiClipNotes', () => {
        const notes = [makeNote()];
        mockedSnapshot.mockReturnValue(notes);
        const result = prepareMidiNoteTransformUndo({
            clipId: 'c1',
            label: 'Quantize',
            transform: () => [makeNote({ startBeat: 0.5 })],
        });
        expect(result.description.redoAction?.type).toBe('restoreMidiClipNotes');
        expect(result.description.redoAction).toMatchObject({
            payload: {
                noteTransformReplayGuard: {
                    trackId: TRACK_ID,
                    expectedTrackFrozen: false,
                    expectedClipLocked: false,
                },
            },
        });
    });

    it('fails closed when changed notes have no authoritative writable MIDI target', () => {
        setTrackStoreState({ ...defaultTrackState, tracks: [] });
        const notes = [makeNote()];
        mockedSnapshot.mockReturnValue(notes);

        const result = prepareMidiNoteTransformUndo({
            clipId: CLIP_ID,
            label: 'Quantize',
            transform: () => [makeNote({ startBeat: 0.5 })],
        });

        expect(result).toEqual({ description: { label: 'Quantize' }, isNoop: false });
    });
});
