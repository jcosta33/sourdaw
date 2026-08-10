import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: vi.fn(),
}));

import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';

import { hasDurableMidiGenerationResult } from '../hasDurableMidiGenerationResult';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedGetNotes = vi.mocked(getNotesForClip);

function makeNote(overrides: Record<string, unknown> = {}) {
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

const baseClip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
const baseInput = {
    trackId: 't1',
    clip: baseClip,
    notes: [makeNote()],
    noteMatch: 'exact' as const,
};

function setTrack(clip: Record<string, unknown> | null) {
    if (clip === null) {
        mockedGetState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] } as never);
    } else {
        mockedGetState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('hasDurableMidiGenerationResult — clip mismatch', () => {
    it('returns false when clip not found', () => {
        setTrack(null);
        expect(hasDurableMidiGenerationResult(baseInput)).toBe(false);
    });

    it('returns false when clip name changed', () => {
        setTrack({ ...baseClip, name: 'Changed' });
        expect(hasDurableMidiGenerationResult(baseInput)).toBe(false);
    });

    it('returns false when clip type changed', () => {
        setTrack({ ...baseClip, type: 'audio' });
        expect(hasDurableMidiGenerationResult(baseInput)).toBe(false);
    });
});

describe('hasDurableMidiGenerationResult — exact match', () => {
    it('returns true when clip matches and notes are identical', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote()] as never);
        expect(hasDurableMidiGenerationResult({ ...baseInput, noteMatch: 'exact' })).toBe(true);
    });

    it('returns false when note count differs', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote(), makeNote({ id: 'n2' })] as never);
        expect(hasDurableMidiGenerationResult({ ...baseInput, noteMatch: 'exact' })).toBe(false);
    });

    it('returns false when a note field differs', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote({ pitch: 64 })] as never);
        expect(hasDurableMidiGenerationResult({ ...baseInput, noteMatch: 'exact' })).toBe(false);
    });

    it('returns false when a note articulation differs', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote({ articulation: 'legato' })] as never);
        expect(
            hasDurableMidiGenerationResult({
                ...baseInput,
                notes: [makeNote({ articulation: 'staccato' })],
                noteMatch: 'exact',
            })
        ).toBe(false);
    });
});

describe('hasDurableMidiGenerationResult — contains match', () => {
    it('returns true when all expected notes are present (superset)', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote(), makeNote({ id: 'n2', pitch: 64 })] as never);
        expect(hasDurableMidiGenerationResult({ ...baseInput, notes: [makeNote()], noteMatch: 'contains' })).toBe(true);
    });

    it('returns false when an expected note is missing', () => {
        setTrack(baseClip);
        mockedGetNotes.mockReturnValue([makeNote({ id: 'other' })] as never);
        expect(hasDurableMidiGenerationResult({ ...baseInput, notes: [makeNote()], noteMatch: 'contains' })).toBe(
            false
        );
    });
});
