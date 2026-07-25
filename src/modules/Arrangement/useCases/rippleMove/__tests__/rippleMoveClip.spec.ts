import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveClip } from '#/modules/Arrangement/useCases/clip/moveClip';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { rippleMoveClip } from '#/modules/Arrangement/useCases/rippleMove/rippleMoveClip';
import { setTrackState } from '#/modules/Arrangement/useCases/setTrackState';

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackState', () => ({
    setTrackState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clip/moveClip', () => ({
    moveClip: vi.fn(),
}));

const { shiftClipAutomation } = vi.hoisted(() => ({
    shiftClipAutomation: vi.fn<(clipId: string, delta: number) => void>(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation,
}));

describe('rippleMoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shifts collateral clips automation by their net ripple delta (regression: ledger M-025)', () => {
        const initialState = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 30, endBeat: 34 },
                        { id: 'c2', startBeat: 10, endBeat: 12 },
                        { id: 'c3', startBeat: 20, endBeat: 22 },
                        { id: 'c4', startBeat: 15, endBeat: 16 },
                    ],
                },
            ],
        };
        vi.mocked(getTrackStoreState).mockReturnValue(initialState as any);

        rippleMoveClip({
            trackId: 't1',
            clipId: 'c1',
            newStartBeat: 30,
            clipDuration: 4,
            plan: {
                gapClosedClips: [
                    { clipId: 'c2', origStartBeat: 10, origEndBeat: 12 },
                    { clipId: 'c4', origStartBeat: 15, origEndBeat: 16 },
                ],
                destinationOpenedClips: [
                    { clipId: 'c3', origStartBeat: 20, origEndBeat: 22 },
                    { clipId: 'c4', origStartBeat: 15, origEndBeat: 16 },
                ],
            },
        });

        // c2 closes the gap (-4), c3 opens the destination (+4), c4 nets to
        // zero and must not be touched. Clip-relative MIDI notes need no work.
        expect(shiftClipAutomation).toHaveBeenCalledTimes(2);
        expect(shiftClipAutomation).toHaveBeenCalledWith('c2', -4);
        expect(shiftClipAutomation).toHaveBeenCalledWith('c3', 4);
        expect(shiftClipAutomation).not.toHaveBeenCalledWith('c4', expect.anything());
    });

    it('should call moveClip and shift surrounding clips', () => {
        const initialState = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 30, endBeat: 34 }, // already moved in first step
                        { id: 'c2', startBeat: 10, endBeat: 12 },
                        { id: 'c3', startBeat: 20, endBeat: 22 },
                    ],
                },
            ],
        };
        vi.mocked(getTrackStoreState).mockReturnValue(initialState as any);

        const plan = {
            gapClosedClips: [{ clipId: 'c2', origStartBeat: 10, origEndBeat: 12 }],
            destinationOpenedClips: [{ clipId: 'c3', origStartBeat: 20, origEndBeat: 22 }],
        };

        rippleMoveClip({
            trackId: 't1',
            clipId: 'c1',
            newStartBeat: 30,
            clipDuration: 4,
            plan,
        });

        // 1. Core move
        expect(moveClip).toHaveBeenCalledWith('c1', 't1', 30);

        // 2. Ripple shift
        expect(vi.mocked(setTrackState)).toHaveBeenCalledWith(
            expect.objectContaining({
                tracks: [
                    expect.objectContaining({
                        id: 't1',
                        clips: [
                            expect.objectContaining({ id: 'c1', startBeat: 30 }),
                            expect.objectContaining({ id: 'c2', startBeat: 6 }), // Gap closed: 10 - 4
                            expect.objectContaining({ id: 'c3', startBeat: 24 }), // Destination opened: 20 + 4
                        ],
                    }),
                ],
            })
        );
    });

    it('returns after moveClip when the track store has not loaded', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        rippleMoveClip({
            trackId: 't1',
            clipId: 'c1',
            newStartBeat: 30,
            clipDuration: 4,
            plan: { gapClosedClips: [], destinationOpenedClips: [] },
        });

        expect(vi.mocked(moveClip)).toHaveBeenCalledTimes(1);
        expect(setTrackState).not.toHaveBeenCalled();
        expect(shiftClipAutomation).not.toHaveBeenCalled();
    });

    it('leaves unrelated tracks untouched while shifting clips on the target track', () => {
        // A second track in the store must be returned by reference (the
        // trackId guard short-circuits before mapping its clips).
        const otherTrack = { id: 'other', clips: [{ id: 'oc1', startBeat: 0, endBeat: 2 }] };
        const initialState = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 10, endBeat: 12 },
                    ],
                },
                otherTrack,
            ],
        };
        vi.mocked(getTrackStoreState).mockReturnValue(initialState as any);

        rippleMoveClip({
            trackId: 't1',
            clipId: 'c1',
            newStartBeat: 0,
            clipDuration: 4,
            plan: {
                gapClosedClips: [{ clipId: 'c2', origStartBeat: 10, origEndBeat: 12 }],
                destinationOpenedClips: [],
            },
        });

        const newState = vi.mocked(setTrackState).mock.calls[0]?.[0] as { tracks: unknown[] };
        // The unrelated track is returned verbatim (same reference).
        expect(newState.tracks[1]).toBe(otherTrack);
    });
});
