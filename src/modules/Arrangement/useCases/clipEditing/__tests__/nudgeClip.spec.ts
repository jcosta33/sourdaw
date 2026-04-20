import { describe, it, expect, vi, beforeEach } from 'vitest';

import { nudgeClip } from '../nudgeClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('nudgeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shifts both start and end beats', () => {
        nudgeClip('c1', 2);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = mocks.updateClip.mock.calls[0][1];

        const mockClip = { startBeat: 4, endBeat: 8, locked: false };
        const result = updater(mockClip);

        expect(result.startBeat).toBe(6);
        expect(result.endBeat).toBe(10);
    });

    it('claps to zero start', () => {
        nudgeClip('c1', -10);
        const updater = mocks.updateClip.mock.calls[0][1];
        const result = updater({ startBeat: 4, endBeat: 8, locked: false });

        expect(result.startBeat).toBe(0);
        expect(result.endBeat).toBe(4);
    });

    it('respects lock status', () => {
        nudgeClip('c1', 1);
        const updater = mocks.updateClip.mock.calls[0][1];
        const mockClip = { startBeat: 4, endBeat: 8, locked: true };
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });
});
