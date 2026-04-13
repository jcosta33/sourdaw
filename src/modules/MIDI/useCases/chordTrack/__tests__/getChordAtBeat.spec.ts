import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { chordTrackStore } from '../../../stores/chordTrackStore';

import { getChordAtBeat } from '../getChordAtBeat';

const CHORD_STORAGE_KEY = 'sourdaw_chord_track';

const ev = (id: string, beat: number, duration: number) => ({
    id,
    beat,
    root: 0,
    quality: 'major' as const,
    duration,
});

describe('getChordAtBeat', () => {
    beforeEach(() => {
        localStorage.removeItem(CHORD_STORAGE_KEY);
        chordTrackStore.set({ enabled: true, events: [] });
    });

    afterEach(() => {
        localStorage.removeItem(CHORD_STORAGE_KEY);
    });

    it('should return null when the chord track is disabled', () => {
        chordTrackStore.set({ enabled: false, events: [ev('a', 0, 4)] });
        expect(getChordAtBeat(0)).toBeNull();
    });

    it('should return null when there are no events', () => {
        expect(getChordAtBeat(0)).toBeNull();
    });

    it('should return null when the beat is before any chord', () => {
        chordTrackStore.set({ enabled: true, events: [ev('a', 4, 4)] });
        expect(getChordAtBeat(2)).toBeNull();
    });

    it('should return the chord whose span contains the beat', () => {
        chordTrackStore.set({ enabled: true, events: [ev('c1', 4, 4)] });
        expect(getChordAtBeat(5)?.id).toBe('c1');
    });

    it('should return the last matching event when spans overlap', () => {
        chordTrackStore.set({
            enabled: true,
            events: [ev('first', 0, 8), ev('second', 4, 4)],
        });
        expect(getChordAtBeat(5)?.id).toBe('second');
    });
});
