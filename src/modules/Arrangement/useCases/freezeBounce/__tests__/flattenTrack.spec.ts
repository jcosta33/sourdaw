import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateTrack } from '../../../repositories/track/updateTrack';
import { trackStore } from '../../../stores/trackStore';
import { flattenTrack } from '../flattenTrack';

const mocks = vi.hoisted(() => ({
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('flattenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('does nothing if store state is missing', () => {
        trackStore.set(null);
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
                    freezeState: {
                        status: 'frozen',
                        frozenBufferId: 'buf-123',
                        renderSettings: { tailLengthSeconds: 2 }, // 4 beats at 120 BPM
                    },
                } as any,
            ],
            selectedTrackId: null,
        });

        const didWrite = flattenTrack('t1');

        expect(didWrite).toBe(true);
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        // Execute the updater function passed to updateTrack
        const updateCall = vi.mocked(updateTrack).mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const track = trackStore.value!.tracks[0];
        if (!track) {
            throw new Error('expected track in store');
        }
        const updatedTrack = updateCall[1](track);

        expect(updatedTrack.kind).toBe('audio');
        expect(updatedTrack.devices).toEqual([]);
        expect(updatedTrack.frozen).toBe(false);
        expect(updatedTrack.frozenBufferId).toBeUndefined();
        expect(updatedTrack.freezeState.status).toBe('unfrozen');
        expect(updatedTrack.activeAlternativeId).toMatch(/^alt-flatten-/);
        expect(updatedTrack.alternatives).toEqual([
            expect.objectContaining({
                id: updatedTrack.activeAlternativeId,
                name: 'Flattened',
                clips: updatedTrack.clips,
            }),
        ]);
        expect(updatedTrack.clips).toHaveLength(1);

        const clip = updatedTrack.clips[0];
        if (!clip) {
            throw new Error('expected flattened clip');
        }
        expect(clip.startBeat).toBe(2);
        expect(clip.endBeat).toBe(12); // 8 (clip end) + 2s * (120 BPM / 60) = 8 + 4 beats
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
                    freezeState: {
                        status: 'frozen',
                        frozenBufferId: 'buf-123',
                        renderSettings: { tailLengthSeconds: 2 }, // 4 beats at 120 BPM
                    },
                } as any,
            ],
            selectedTrackId: null,
        });

        flattenTrack('t1');
        const updateCall = vi.mocked(updateTrack).mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const track = trackStore.value!.tracks[0];
        if (!track) {
            throw new Error('expected track in store');
        }
        const updatedTrack = updateCall[1](track);

        const clip = updatedTrack.clips[0];
        if (!clip) {
            throw new Error('expected flattened clip');
        }
        expect(clip.startBeat).toBe(0);
        expect(clip.endBeat).toBe(5); // 1 (default end) + 2s * (120 BPM / 60) = 1 + 4 beats
    });

    it('adds no tail beats when the freeze state has no render settings', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'Synth',
                    color: '#ff0000',
                    clips: [
                        { startBeat: 2, endBeat: 6 },
                        // A clip whose startBeat is not a new minimum exercises the
                        // "no new min" branch, and whose endBeat is not a new max
                        // exercises the "no new max" branch.
                        { startBeat: 4, endBeat: 5 },
                    ],
                    freezeState: {
                        status: 'frozen',
                        frozenBufferId: 'buf-123',
                    },
                } as any,
            ],
            selectedTrackId: null,
        });

        flattenTrack('t1');
        const updateCall = vi.mocked(updateTrack).mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const track = trackStore.value!.tracks[0];
        if (!track) {
            throw new Error('expected track in store');
        }
        const updatedTrack = updateCall[1](track);
        const clip = updatedTrack.clips[0];
        if (!clip) {
            throw new Error('expected flattened clip');
        }
        // No renderSettings => tailLengthSeconds is undefined => tail contribution is 0.
        expect(clip.startBeat).toBe(2);
        expect(clip.endBeat).toBe(6);
    });

    it('rejects an ineligible destination before transport reads, UUID allocation, or replacement', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'VCA',
                    kind: 'vca',
                    clips: [],
                    freezeState: { status: 'frozen', frozenBufferId: 'buf-123' },
                } as never,
            ],
            selectedTrackId: null,
        });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const didWrite = flattenTrack('t1');

        expect(didWrite).toBe(false);
        expect(randomUuid).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
    });
});
