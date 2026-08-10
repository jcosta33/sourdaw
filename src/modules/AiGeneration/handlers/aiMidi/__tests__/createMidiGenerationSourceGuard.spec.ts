import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: vi.fn(),
}));

import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';

import { createMidiGenerationSourceGuard } from '../createMidiGenerationSourceGuard';

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
        pitchBendRangeSemitones: undefined,
        channel: undefined,
        ...overrides,
    };
}

function setTrackAndClip(trackId: string, clip: Record<string, unknown> | null) {
    if (clip === null) {
        mockedGetState.mockReturnValue({ tracks: [{ id: trackId, clips: [] }] } as never);
    } else {
        mockedGetState.mockReturnValue({ tracks: [{ id: trackId, clips: [clip] }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createMidiGenerationSourceGuard — null cases', () => {
    it('returns null when track not found', () => {
        mockedGetState.mockReturnValue({ tracks: [{ id: 'other', clips: [] }] } as never);
        expect(createMidiGenerationSourceGuard('c1')).toBeNull();
    });

    it('returns null when clip not found', () => {
        setTrackAndClip('t1', null);
        expect(createMidiGenerationSourceGuard('c1')).toBeNull();
    });

    it('returns null when clip is not midi type', () => {
        setTrackAndClip('t1', { id: 'c1', name: 'Audio', startBeat: 0, endBeat: 4, type: 'audio' });
        expect(createMidiGenerationSourceGuard('c1')).toBeNull();
    });
});

describe('createMidiGenerationSourceGuard — valid guard', () => {
    it('returns guard with clip snapshot, trackId, and notes', () => {
        setTrackAndClip('t1', { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' });
        mockedGetNotes.mockReturnValue([makeNote()] as never);
        const guard = createMidiGenerationSourceGuard('c1');
        expect(guard).not.toBeNull();
        expect(guard!.clip.id).toBe('c1');
        expect(guard!.clip.name).toBe('Lead');
        expect(guard!.trackId).toBe('t1');
        expect(guard!.notes).toHaveLength(1);
    });

    it('isCurrent returns true when nothing changed', () => {
        const clip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
        const notes = [makeNote()];
        setTrackAndClip('t1', clip);
        mockedGetNotes.mockReturnValue(notes);
        const guard = createMidiGenerationSourceGuard('c1');
        // Re-mock for isCurrent call
        setTrackAndClip('t1', clip);
        mockedGetNotes.mockReturnValue(notes);
        expect(guard!.isCurrent()).toBe(true);
    });

    it('isCurrent returns false when clip name changed', () => {
        const clip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
        mockedGetNotes.mockReturnValue([makeNote()] as never);
        setTrackAndClip('t1', clip);
        const guard = createMidiGenerationSourceGuard('c1');
        setTrackAndClip('t1', { ...clip, name: 'Changed' });
        mockedGetNotes.mockReturnValue([makeNote()] as never);
        expect(guard!.isCurrent()).toBe(false);
    });

    it('isCurrent returns false when notes changed', () => {
        const clip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
        const notes = [makeNote()];
        mockedGetNotes.mockReturnValue(notes);
        setTrackAndClip('t1', clip);
        const guard = createMidiGenerationSourceGuard('c1');
        setTrackAndClip('t1', clip);
        mockedGetNotes.mockReturnValue([makeNote({ pitch: 64 })] as never);
        expect(guard!.isCurrent()).toBe(false);
    });

    it('isCurrent returns false when a note articulation changed', () => {
        const clip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
        mockedGetNotes.mockReturnValue([makeNote({ articulation: 'staccato' })] as never);
        setTrackAndClip('t1', clip);
        const guard = createMidiGenerationSourceGuard('c1');
        setTrackAndClip('t1', clip);
        mockedGetNotes.mockReturnValue([makeNote({ articulation: 'legato' })] as never);
        expect(guard!.isCurrent()).toBe(false);
    });

    it('isCurrent returns false when clip deleted', () => {
        const clip = { id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' };
        mockedGetNotes.mockReturnValue([makeNote()] as never);
        setTrackAndClip('t1', clip);
        const guard = createMidiGenerationSourceGuard('c1');
        setTrackAndClip('t1', null);
        expect(guard!.isCurrent()).toBe(false);
    });
});
