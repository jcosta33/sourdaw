import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGrooveFromClip } from '../extractGrooveFromClip';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {} } },
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() { return mocks.midiStoreValue.value; },
    }
}));

describe('extractGrooveFromClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('extracts timing and velocity deviations from notes', () => {
        // Implementation uses minBeat as the relative zero.
        // If notes are at 0.1 and 0.45:
        // minBeat = 0.1.
        // gridBeat 0 (i=0): 0.1 + 0 = 0.1. Note 1 is at 0.1. Offset = 0.
        // gridBeat 1 (i=1): 0.1 + 0.25 = 0.35. Note 2 is at 0.45. Offset = 0.1.
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { startBeat: 0.1, duration: 1, velocity: 120 },
                    { startBeat: 0.45, duration: 1, velocity: 80 },
                ]
            }
        } as any;

        const groove = extractGrooveFromClip('c1', 0.25);

        expect(groove).not.toBeNull();
        
        // Offset 0 for the first note (which defines the minBeat reference)
        expect(groove?.offsets).toContainEqual(expect.objectContaining({
            gridPosition: 0,
            timingOffset: 0,
            velocityScale: 1.2,
        }));

        // Offset 0.1 for the second note relative to the shifted grid
        expect(groove?.offsets).toContainEqual(expect.objectContaining({
            gridPosition: 1, // 0.1 + 0.25 = 0.35. Wrapped index 1 if division is 0.25? 
            // Wait, wrappedIndex = i % (1/0.25) = i % 4. 
            // i=1. Index 1.
            timingOffset: expect.closeTo(0.1),
            velocityScale: 0.8,
        }));
    });

    it('bails if no notes in clip', () => {
        mocks.midiStoreValue.value = { notesByClipId: { c1: [] } } as any;
        expect(extractGrooveFromClip('c1')).toBeNull();
    });
});
