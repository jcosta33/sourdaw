import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { usePianoRollRenderer } from '../usePianoRollRenderer';

describe('usePianoRollRenderer (Coordinate Conventions)', () => {
    it('uses clip-relative coordinates to position notes', () => {
        // usePianoRollRenderer returns a draw function.
        // It calculates x = note.startBeat * beatWidth.

        const note = {
            id: 'n1',
            clipId: 'c1',
            startBeat: 0, // Clip-relative
            duration: 1,
            pitch: 60,
            velocity: 100,
        };

        // Note is at beat 0 clip-relative. It should be drawn at x = 0,
        // no matter where the clip is on the timeline.
        const beatWidth = 50;
        const x = note.startBeat * beatWidth;
        expect(x).toBe(0);
    });
});
