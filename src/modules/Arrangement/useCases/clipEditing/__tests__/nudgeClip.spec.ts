import { describe, it, expect, vi, beforeEach } from 'vitest';

import { nudgeClip } from '../nudgeClip';

import type { Clip } from '#/modules/Arrangement/models/Track';
import type { updateClip as originalUpdateClip } from '#/modules/Arrangement/repositories/track/updateClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<typeof originalUpdateClip>(),
    getTrackState: vi.fn<() => { tracks: unknown[] } | null>(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

describe('nudgeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shifts both start and end beats', () => {
        nudgeClip('c1', 2);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updateCall = mocks.updateClip.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateClip to have been called');
        }
        const updater = updateCall[1];

        const mockClip = { startBeat: 4, endBeat: 8, locked: false } as Partial<Clip> as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(6);
        expect(result.endBeat).toBe(10);
    });

    it('claps to zero start', () => {
        nudgeClip('c1', -10);
        const updateCall = mocks.updateClip.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateClip to have been called');
        }
        const updater = updateCall[1];
        const result = updater({ startBeat: 4, endBeat: 8, locked: false } as Partial<Clip> as Clip);

        expect(result.startBeat).toBe(0);
        expect(result.endBeat).toBe(4);
    });

    it('respects lock status', () => {
        nudgeClip('c1', 1);
        const updateCall = mocks.updateClip.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateClip to have been called');
        }
        const updater = updateCall[1];
        const mockClip = { startBeat: 4, endBeat: 8, locked: true } as Partial<Clip> as Clip;
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });

    it('skips the lock pre-check and still nudges when the track store is absent', () => {
        // state is null -> the findClipById locked pre-check is skipped, but
        // the nudge write still proceeds through updateClip.
        mocks.getTrackState.mockReturnValue(null);
        mocks.updateClip.mockReturnValue(true);

        expect(nudgeClip('c1', 2)).toBe(true);
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
    });
});
