import { describe, it, expect, vi, beforeEach } from 'vitest';
import { releaseTouchAutomation } from '../releaseTouchAutomation';

const { touchActive, flushPendingPoints } = vi.hoisted(() => {
    const touchActive = new Set<string>();
    return {
        touchActive,
        flushPendingPoints: vi.fn(),
    };
});

vi.mock('../recordingSessionState', () => ({
    touchActive,
    flushPendingPoints,
    makeKey: (trackId: string, parameterId: string) => `${trackId}::${parameterId}`,
}));

describe('releaseTouchAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        touchActive.clear();
    });

    it('removes the key from touchActive and flushes pending points for that parameter', () => {
        touchActive.add('t1::gain');

        releaseTouchAutomation('t1', 'gain');

        expect(touchActive.has('t1::gain')).toBe(false);
        expect(flushPendingPoints).toHaveBeenCalledTimes(1);
        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
    });

    it('is a no-op on touchActive when the key was not active', () => {
        releaseTouchAutomation('t2', 'pan');

        expect(flushPendingPoints).toHaveBeenCalledWith('t2::pan');
        expect(touchActive.size).toBe(0);
    });
});
