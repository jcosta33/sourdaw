import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { trackStore } from '../../../stores/trackStore';
import { initStalenessDetection } from '../initStalenessDetection';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));

describe('initStalenessDetection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('returns an unsubscribe function', () => {
        const unsub = initStalenessDetection();
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('does nothing if no tracks are frozen', async () => {
        const unsub = initStalenessDetection();
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'unfrozen' }, clips: [] } as any],
            selectedTrackId: null,
        });

        // allow microtasks to flush
        await new Promise((r) => setTimeout(r, 0));

        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('sets status to stale if frozen track content hash changes', async () => {
        // Initial state with a frozen track
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'old-hash' },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();

        vi.mocked(computeTrackHash).mockResolvedValue('new-hash');

        // Mutate the clips array reference to trigger detection
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'old-hash' },
                    clips: [{}], // new reference
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((r) => setTimeout(r, 0));

        expect(computeTrackHash).toHaveBeenCalled();
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const updater = vi.mocked(updateTrack).mock.calls[0][1] as any;
        const track = trackStore.value!.tracks[0];
        const updatedTrack = updater(track);

        expect(updatedTrack.freezeState.status).toBe('stale');
        unsub();
    });

    it('does not set status to stale if hash remains the same despite reference change', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'same-hash' },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();

        vi.mocked(computeTrackHash).mockResolvedValue('same-hash');

        // Mutate the clips array reference
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'same-hash' },
                    clips: [{}], // new reference
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((r) => setTimeout(r, 0));

        expect(computeTrackHash).toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });
});
