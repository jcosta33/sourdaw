import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackStore } from '../../../stores/trackStore';
import { freezeTrack } from '../freezeTrack';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { renderTrackOffline } from '../renderOffline';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));

vi.mock('../renderOffline', () => ({
    renderTrackOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        set: vi.fn(),
    },
}));

describe('freezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
    });

    it('does nothing if store state is missing', async () => {
        trackStore.set(null as any);
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is not found', async () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is already frozen', async () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'frozen' } } as any],
            selectedTrackId: null,
        });
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('freezes the track successfully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [{ startBeat: 2, endBeat: 6 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        expect(updateTrack).toHaveBeenCalledTimes(2);

        // First call: sets status to 'freezing'
        const freezingUpdater = vi.mocked(updateTrack).mock.calls[0][1] as any;
        const freezingTrack = freezingUpdater(trackStore.value!.tracks[0]);
        expect(freezingTrack.freezeState.status).toBe('freezing');
        expect(freezingTrack.freezeState.renderProgress).toBe(0);

        // Second call: sets status to 'frozen'
        const frozenUpdater = vi.mocked(updateTrack).mock.calls[1][1] as any;
        const frozenTrack = frozenUpdater(trackStore.value!.tracks[0]);
        
        expect(frozenTrack.frozen).toBe(true);
        expect(frozenTrack.frozenBufferId).toMatch(/^freeze-t1-/);
        expect(frozenTrack.freezeState.status).toBe('frozen');
        expect(frozenTrack.freezeState.sourceContentHash).toBe('mock-hash');
        expect(frozenTrack.freezeState.renderedAt).toBe(1234567890);
        
        expect(audioBufferCache.set).toHaveBeenCalledWith(frozenTrack.frozenBufferId, expect.any(Object));
        expect(renderTrackOffline).toHaveBeenCalledWith(expect.any(Object), 2, 6 + 4); // 6 end + 4 tail
    });

    it('handles render failure gracefully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockRejectedValue(new Error('Render crashed'));

        await freezeTrack('t1');

        expect(updateTrack).toHaveBeenCalledTimes(2);

        const errorUpdater = vi.mocked(updateTrack).mock.calls[1][1] as any;
        const errorTrack = errorUpdater(trackStore.value!.tracks[0]);
        
        expect(errorTrack.freezeState.status).toBe('error');
        expect(errorTrack.freezeState.errorMessage).toBe('Render crashed');
    });

    it('uses defaults 0 and 1 if track has no clips', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');
        
        expect(renderTrackOffline).toHaveBeenCalledWith(expect.any(Object), 0, 1 + 4);
    });
});
