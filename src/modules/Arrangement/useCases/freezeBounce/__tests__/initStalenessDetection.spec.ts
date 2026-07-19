import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeFreezeRenderInputHash } from '../../../services/computeFreezeRenderInputHash';
import { trackStore } from '../../../stores/trackStore';
import { initStalenessDetection } from '../initStalenessDetection';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../services/computeFreezeRenderInputHash', () => ({
    computeFreezeRenderInputHash: vi.fn().mockResolvedValue('freeze-v2:mock-hash'),
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
        await new Promise((resolve) => setTimeout(resolve, 0));

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

        vi.mocked(computeFreezeRenderInputHash).mockResolvedValue('freeze-v2:new-hash');

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

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeFreezeRenderInputHash).toHaveBeenCalled();
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

        expect(updatedTrack.freezeState.status).toBe('stale');
        unsub();
    });

    it('does not set status to stale if hash remains the same despite reference change', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'freeze-v2:same-hash' },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();

        vi.mocked(computeFreezeRenderInputHash).mockResolvedValue('freeze-v2:same-hash');

        // Mutate the clips array reference
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'freeze-v2:same-hash' },
                    clips: [{}], // new reference
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeFreezeRenderInputHash).toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('coalesces changes during hashing and publishes only against current track truth', async () => {
        const initial_clips: never[] = [];
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'freeze-v2:same-hash' },
                    clips: initial_clips,
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });
        let finish_first_hash!: (hash: string) => void;
        vi.mocked(computeFreezeRenderInputHash)
            .mockReturnValueOnce(
                new Promise<string>((resolve) => {
                    finish_first_hash = resolve;
                })
            )
            .mockResolvedValueOnce('freeze-v2:same-hash');
        const unsub = initStalenessDetection();
        const first_clips = [{}] as any[];
        const latest_clips = [{ id: 'latest' }] as any[];

        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'freeze-v2:same-hash' },
                    clips: first_clips,
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });
        await vi.waitFor(() => expect(computeFreezeRenderInputHash).toHaveBeenCalledTimes(1));
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: { status: 'frozen', sourceContentHash: 'freeze-v2:same-hash' },
                    clips: latest_clips,
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });
        finish_first_hash('freeze-v2:changed-first-snapshot');

        await vi.waitFor(() => expect(computeFreezeRenderInputHash).toHaveBeenCalledTimes(2));
        expect(vi.mocked(computeFreezeRenderInputHash).mock.calls[1]?.[0]).toBe(latest_clips);
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });
});
