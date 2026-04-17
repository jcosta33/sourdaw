import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackStore } from '../../../stores/trackStore';
import { flattenTrack } from '../flattenTrack';
import { updateTrack } from '../../../repositories/track/updateTrack';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

describe('flattenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('does nothing if store state is missing', () => {
        trackStore.set(null as any);
        flattenTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is not found', () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        flattenTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is not frozen', () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'unfrozen' }, clips: [] } as any],
            selectedTrackId: null,
        });
        flattenTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track lacks frozenBufferId', () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'frozen', frozenBufferId: undefined }, clips: [] } as any],
            selectedTrackId: null,
        });
        flattenTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('flattens the track, computing start and end beats from existing clips', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'Synth',
                    color: '#ff0000',
                    clips: [
                        { startBeat: 4, endBeat: 8 },
                        { startBeat: 2, endBeat: 6 },
                    ],
                    freezeState: { status: 'frozen', frozenBufferId: 'buf-123' },
                } as any,
            ],
            selectedTrackId: null,
        });

        flattenTrack('t1');

        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        
        // Execute the updater function passed to updateTrack
        const updater = vi.mocked(updateTrack).mock.calls[0][1] as any;
        const track = trackStore.value!.tracks[0];
        const updatedTrack = updater(track);

        expect(updatedTrack.kind).toBe('audio');
        expect(updatedTrack.devices).toEqual([]);
        expect(updatedTrack.frozen).toBe(false);
        expect(updatedTrack.frozenBufferId).toBeUndefined();
        expect(updatedTrack.freezeState.status).toBe('unfrozen');
        expect(updatedTrack.clips).toHaveLength(1);
        
        const clip = updatedTrack.clips[0];
        expect(clip.startBeat).toBe(2);
        expect(clip.endBeat).toBe(12); // 8 + 4 tail
        expect(clip.type).toBe('audio');
        expect(clip.audioBufferId).toBe('buf-123');
        expect(clip.name).toBe('Synth (Flattened)');
        expect(clip.color).toBe('#ff0000');
    });

    it('uses defaults 0 and 1 if track has no clips', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'Synth',
                    color: '#ff0000',
                    clips: [],
                    freezeState: { status: 'frozen', frozenBufferId: 'buf-123' },
                } as any,
            ],
            selectedTrackId: null,
        });

        flattenTrack('t1');
        const updater = vi.mocked(updateTrack).mock.calls[0][1] as any;
        const track = trackStore.value!.tracks[0];
        const updatedTrack = updater(track);

        const clip = updatedTrack.clips[0];
        expect(clip.startBeat).toBe(0);
        expect(clip.endBeat).toBe(5); // 1 + 4 tail
    });
});
