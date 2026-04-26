import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { humanizeNotes } from '../humanizeNotes';

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('humanizeNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: { clip1: [note('a')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return a finite seed even when the clip cannot be updated', () => {
        const missingClip = humanizeNotes('missing', 1);
        expect(Number.isFinite(missingClip)).toBe(true);
        midiStore.set(null);
        const noStore = humanizeNotes('clip1', 1);
        expect(Number.isFinite(noStore)).toBe(true);
    });

    it('should return the provided seed when a seed is passed', () => {
        const seed = humanizeNotes('clip1', 0, 0, 999);
        expect(seed).toBe(999);
    });

    it('should return a numeric seed when none is provided', () => {
        const seed = humanizeNotes('clip1', 0, 0);
        expect(Number.isFinite(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
    });
});
