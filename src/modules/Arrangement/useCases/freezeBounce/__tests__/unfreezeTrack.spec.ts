import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateTrack } from '../../../repositories/track/updateTrack';
import { trackStore } from '../../../stores/trackStore';
import { unfreezeTrack } from '../unfreezeTrack';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

describe('unfreezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('does nothing if store state is missing', () => {
        trackStore.set(null as any);
        unfreezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is not found', () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        unfreezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is already unfrozen', () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'unfrozen' } } as any],
            selectedTrackId: null,
        });
        unfreezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('unfreezes the track and resets its freezeState', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    frozen: true,
                    frozenBufferId: 'buf-123',
                    freezeState: { status: 'frozen', frozenBufferId: 'buf-123' },
                } as any,
            ],
            selectedTrackId: null,
        });

        unfreezeTrack('t1');

        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const call = vi.mocked(updateTrack).mock.calls[0];
        if (!call) {
            throw new Error('expected updateTrack to be called');
        }
        const updater = call[1];
        const track = trackStore.value?.tracks[0];
        if (!track) {
            throw new Error('expected a track in the store');
        }
        const updatedTrack = updater(track);

        expect(updatedTrack.frozen).toBe(false);
        expect(updatedTrack.frozenBufferId).toBeUndefined();
        expect(updatedTrack.freezeState.status).toBe('unfrozen');
    });
});
