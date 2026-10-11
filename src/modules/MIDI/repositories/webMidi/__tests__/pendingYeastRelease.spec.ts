import { afterEach, describe, expect, it, vi } from 'vitest';

import { pendingYeastRelease } from '../pendingYeastRelease';

afterEach(() => {
    pendingYeastRelease.releaseAllPending();
});

describe('pendingYeastRelease', () => {
    // Two tracks each with a Yeast, and two Yeasts' routes on one track: a
    // removed Yeast's route release ends its own voices and no other route's.
    it('releases only the removed route’s voices when voices are registered on several routes', () => {
        const removed = vi.fn();
        const otherTrack = vi.fn();
        const otherYeast = vi.fn();
        pendingYeastRelease.registerVoice('track-1:yeast-a', 'track-1', 'gen-1', 72, 0, removed);
        pendingYeastRelease.registerVoice('track-2:yeast-b', 'track-2', 'gen-2', 72, 0, otherTrack);
        pendingYeastRelease.registerVoice('track-1:yeast-c', 'track-1', 'gen-3', 76, 0, otherYeast);

        pendingYeastRelease.releaseRoute('track-1:yeast-a', 1_000, 0);

        expect(removed).toHaveBeenCalledExactlyOnceWith(1_000, 0);
        expect(otherTrack).not.toHaveBeenCalled();
        expect(otherYeast).not.toHaveBeenCalled();
    });

    it('releases a track’s voices at one channel and pitch across its routes, and nothing else', () => {
        const routeA = vi.fn();
        const routeB = vi.fn();
        const otherChannel = vi.fn();
        const otherPitch = vi.fn();
        const otherTrack = vi.fn();
        pendingYeastRelease.registerVoice('track-1:yeast-a', 'track-1', 'gen-1', 67, 0, routeA);
        pendingYeastRelease.registerVoice('track-1:yeast-b', 'track-1', 'gen-2', 67, 0, routeB);
        pendingYeastRelease.registerVoice('track-1:yeast-a', 'track-1', 'gen-3', 67, 1, otherChannel);
        pendingYeastRelease.registerVoice('track-1:yeast-a', 'track-1', 'gen-4', 68, 0, otherPitch);
        pendingYeastRelease.registerVoice('track-2:yeast-a', 'track-2', 'gen-5', 67, 0, otherTrack);

        pendingYeastRelease.releaseTrackPitch('track-1', 0, 67, undefined, 0);
        pendingYeastRelease.releaseTrackPitch('track-1', 0, 67, undefined, 0);

        expect(routeA).toHaveBeenCalledExactlyOnceWith(undefined, 0);
        expect(routeB).toHaveBeenCalledExactlyOnceWith(undefined, 0);
        expect(otherChannel).not.toHaveBeenCalled();
        expect(otherPitch).not.toHaveBeenCalled();
        expect(otherTrack).not.toHaveBeenCalled();
    });
});
