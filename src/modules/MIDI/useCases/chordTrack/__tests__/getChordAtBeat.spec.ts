import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { chordTrackStore } from '../../../stores/chordTrackStore';
import { getChordAtBeat } from '../getChordAtBeat';

const CHORD_STORAGE_KEY = 'sourdaw_chord_track';

function ev(id: string, beat: number, duration: number) {
    return {
        id,
        beat,
        root: 0,
        quality: 'major' as const,
        duration,
    };
}

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

    it('should fall back to an earlier covering event when the latest does not reach', () => {
        // 'second' starts at beat 4 but is short (covers [4,5)); the query beat 6 sits
        // in the gap after it yet still inside 'first' ([0,8)). The search must walk
        // back from the latest beat ≤ query to the earlier event that still covers.
        chordTrackStore.set({
            enabled: true,
            events: [ev('first', 0, 8), ev('second', 4, 1)],
        });
        expect(getChordAtBeat(6)?.id).toBe('first');
    });

    it('should return null when the beat is past every chord span', () => {
        chordTrackStore.set({
            enabled: true,
            events: [ev('a', 0, 2), ev('b', 4, 2)],
        });
        expect(getChordAtBeat(10)).toBeNull();
        expect(getChordAtBeat(3)).toBeNull(); // gap between spans
    });

    it('should locate the covering span among many sorted events', () => {
        chordTrackStore.set({
            enabled: true,
            events: [ev('a', 0, 1), ev('b', 1, 1), ev('c', 2, 1), ev('d', 3, 1), ev('e', 4, 1)],
        });
        expect(getChordAtBeat(2.5)?.id).toBe('c');
        expect(getChordAtBeat(0)?.id).toBe('a');
        expect(getChordAtBeat(4.5)?.id).toBe('e');
    });
});
