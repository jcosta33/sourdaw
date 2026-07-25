import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trimClipEnd } from '../trimClipEnd';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
    getTrackState: vi.fn<() => { tracks: unknown[] } | null>(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

describe('trimClipEnd', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates endBeat', () => {
        trimClipEnd('c1', 15);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updateCall = mocks.updateClip.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateClip to have been called');
        }
        const updater = updateCall[1];

        const mockClip = { startBeat: 10, endBeat: 12 };
        const result = updater(mockClip);

        expect(result.endBeat).toBe(15);
    });

    it('ignores if new end is before startBeat', () => {
        trimClipEnd('c1', 5);
        const updateCall = mocks.updateClip.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateClip to have been called');
        }
        const updater = updateCall[1];
        const mockClip = { startBeat: 10, endBeat: 12 };
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });

    it('skips the pre-check and still trims when the track store is absent', () => {
        // state is null -> the startBeat pre-check is skipped, and the trim
        // proceeds through updateClip's own guard.
        mocks.getTrackState.mockReturnValue(null);
        mocks.updateClip.mockReturnValue(true);

        expect(trimClipEnd('c1', 15)).toBe(true);
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
    });
});
