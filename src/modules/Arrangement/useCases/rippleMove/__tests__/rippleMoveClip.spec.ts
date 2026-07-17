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

describe('rippleMoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
