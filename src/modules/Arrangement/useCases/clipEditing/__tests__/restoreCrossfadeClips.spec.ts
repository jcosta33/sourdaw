import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveEligible, mockGetTrackState, mockMapAllTracks } = vi.hoisted(() => ({
    mockResolveEligible: vi.fn(),
    mockGetTrackState: vi.fn(),
    mockMapAllTracks: vi.fn(),
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mockResolveEligible,
}));
vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mockGetTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mockMapAllTracks }));

import { restoreCrossfadeClips } from '../restoreCrossfadeClips';

function eligible() {
    return { status: 'eligible' as const, trackId: 't1', trackKind: 'audio' };
}

function ineligible() {
    return { status: 'ineligible' as const };
}

function makeClip(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        ...overrides,
    };
}

function makeState(clips: unknown[]) {
    return { tracks: [{ id: 't1', name: 'T1', clips }] };
}

describe('restoreCrossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockResolveEligible.mockReturnValue(eligible());
    });

    it('returns false when both clip ids are the same', () => {
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c1',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 1, clipBStartBeat: 4, clipBFadeInBeats: 1 },
        });
        expect(result).toBe(false);
    });

    it('returns false when either clip is not eligible for writing', () => {
        mockResolveEligible.mockReturnValueOnce(ineligible());
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 1, clipBStartBeat: 4, clipBFadeInBeats: 1 },
        });
        expect(result).toBe(false);
    });

    it('returns false when replacement values are not finite', () => {
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: {
                clipAEndBeat: Number.NaN,
                clipAFadeOutBeats: 1,
                clipBStartBeat: 4,
                clipBFadeInBeats: 1,
            },
        });
        expect(result).toBe(false);
    });

    it('returns false when fade values are negative', () => {
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: -1, clipBStartBeat: 4, clipBFadeInBeats: 1 },
        });
        expect(result).toBe(false);
    });

    it('returns false when clips are not found in the track state', () => {
        mockGetTrackState.mockReturnValue(makeState([]));
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 1, clipBStartBeat: 4, clipBFadeInBeats: 1 },
        });
        expect(result).toBe(false);
    });

    it('returns false when the replacement matches the current state (no change)', () => {
        const clipA = makeClip('c1', { endBeat: 4, fadeOutBeats: 1 });
        const clipB = makeClip('c2', { startBeat: 4, fadeInBeats: 1 });
        mockGetTrackState.mockReturnValue(makeState([clipA, clipB]));
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 1, clipBStartBeat: 4, clipBFadeInBeats: 1 },
        });
        expect(result).toBe(false);
        expect(mockMapAllTracks).not.toHaveBeenCalled();
    });

    it('mutates clips via mapAllTracks and returns true when the replacement differs', () => {
        const clipA = makeClip('c1', { endBeat: 3, fadeOutBeats: 0 });
        const clipB = makeClip('c2', { startBeat: 5, fadeInBeats: 0 });
        mockGetTrackState.mockReturnValue(makeState([clipA, clipB]));
        const result = restoreCrossfadeClips({
            clipAId: 'c1',
            clipBId: 'c2',
            replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 0.5, clipBStartBeat: 4, clipBFadeInBeats: 0.5 },
        });
        expect(result).toBe(true);
        expect(mockMapAllTracks).toHaveBeenCalledTimes(1);
        const updater = mockMapAllTracks.mock.calls[0]?.[0];
        const updatedTrack = updater({
            id: 't1',
            name: 'T1',
            clips: [clipA, clipB],
        });
        const updatedA = updatedTrack.clips[0];
        const updatedB = updatedTrack.clips[1];
        expect(updatedA.endBeat).toBe(4);
        expect(updatedA.fadeOutBeats).toBe(0.5);
        expect(updatedB.startBeat).toBe(4);
        expect(updatedB.fadeInBeats).toBe(0.5);
    });
});
