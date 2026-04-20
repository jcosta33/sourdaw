import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { rippleInsertClip } from '#/modules/Arrangement/useCases/rippleInsert/rippleInsertClip';
import { setTrackState } from '#/modules/Arrangement/useCases/setTrackState';

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackState', () => ({
    setTrackState: vi.fn(),
}));

describe('rippleInsertClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should shift clips forward based on the plan', () => {
        const initialState = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c2', startBeat: 2, endBeat: 4 },
                        { id: 'c3', startBeat: 5, endBeat: 6 },
                    ],
                },
            ],
        };
        vi.mocked(getTrackStoreState).mockReturnValue(initialState as any);

        const plan = {
            shiftedClips: [
                { clipId: 'c2', origStartBeat: 2, origEndBeat: 4 },
                { clipId: 'c3', origStartBeat: 5, origEndBeat: 6 },
            ],
        };

        rippleInsertClip({
            trackId: 't1',
            insertDuration: 1.5,
            plan,
        });

        expect(vi.mocked(setTrackState)).toHaveBeenCalledWith(
            expect.objectContaining({
                tracks: [
                    expect.objectContaining({
                        id: 't1',
                        clips: [
                            expect.objectContaining({ id: 'c2', startBeat: 3.5 }),
                            expect.objectContaining({ id: 'c3', startBeat: 6.5 }),
                        ],
                    }),
                ],
            })
        );
    });
});
