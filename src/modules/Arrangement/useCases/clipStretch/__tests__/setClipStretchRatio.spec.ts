import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

import { setClipStretchRatio } from '../setClipStretchRatio';

describe('setClipStretchRatio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default happy path: updateClip reports a successful write.
        mocks.updateClip.mockReturnValue(true);
    });

    it('rejects a non-finite ratio without writing', () => {
        expect(setClipStretchRatio('c1', Number.NaN)).toBe(false);
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('stores the clamped ratio and leaves the end beat untouched for a non-repitch clip', () => {
        setClipStretchRatio('c1', 0.5);

        const updater = mocks.updateClip.mock.calls[0]![1] as (c: unknown) => unknown;
        const next = updater({ id: 'c1', startBeat: 0, endBeat: 4, stretchMode: 'stretch' }) as {
            stretchRatio: number;
            endBeat: number;
        };

        expect(next.stretchRatio).toBe(0.5);
        // Non-repitch clips keep their timeline length regardless of ratio.
        expect(next.endBeat).toBe(4);
    });

    it('recomputes the end beat for a repitch clip from its stored base duration', () => {
        setClipStretchRatio('c1', 2);

        const updater = mocks.updateClip.mock.calls[0]![1] as (c: unknown) => unknown;
        // A repitch clip with stored ratio 0.5 over a 4-beat span has a 2-beat
        // base duration (4 * 0.5); doubling the ratio to 2 must shrink the span
        // to base / ratio = 2 / 2 = 1 beat.
        const next = updater({
            id: 'c1',
            startBeat: 0,
            endBeat: 4,
            stretchRatio: 0.5,
            stretchMode: 'repitch',
        }) as { stretchRatio: number; endBeat: number };

        expect(next.stretchRatio).toBe(2);
        expect(next.endBeat).toBe(1);
    });

    it('treats an absent prior ratio as 1:1 when recomputing a repitch clip', () => {
        setClipStretchRatio('c1', 2);

        const updater = mocks.updateClip.mock.calls[0]![1] as (c: unknown) => unknown;
        // A repitch clip that has never been stretched has no stored ratio;
        // the base duration equals the current span, so doubling the ratio
        // halves a 4-beat span to 2 beats.
        const next = updater({
            id: 'c1',
            startBeat: 0,
            endBeat: 4,
            stretchMode: 'repitch',
        }) as { stretchRatio: number; endBeat: number };

        expect(next.stretchRatio).toBe(2);
        expect(next.endBeat).toBe(2);
    });
});
