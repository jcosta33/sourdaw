import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fitClipToBeats } from '../fitClipToBeats';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('fitClipToBeats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when target beats is not positive', () => {
        fitClipToBeats('c1', 0);

        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('returns early when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        fitClipToBeats('c1', 8);

        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('returns early when the clip id is not on any track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'other', startBeat: 0, endBeat: 4 }] }],
        });

        fitClipToBeats('missing', 8);

        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('updates stretch ratio and end beat to fit the clip to the target duration', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            startBeat: 0,
                            endBeat: 4,
                            stretchRatio: 1,
                            stretchMode: 'off' as const,
                        },
                    ],
                },
            ],
        });

        fitClipToBeats('c1', 8);

        expect(mocks.updateClip).toHaveBeenCalledTimes(1);
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));

        const updater = mocks.updateClip.mock.calls[0]![1] as (c: any) => any;
        const next = updater({
            id: 'c1',
            startBeat: 0,
            endBeat: 4,
            stretchRatio: 1,
            stretchMode: 'off' as const,
        });

        expect(next.endBeat).toBe(8);
        expect(next.stretchRatio).toBe(0.5);
        expect(next.stretchMode).toBe('repitch');
    });

    it('preserves a non-off stretch mode when fitting', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            startBeat: 0,
                            endBeat: 4,
                            stretchRatio: 1,
                            stretchMode: 'stretch' as const,
                        },
                    ],
                },
            ],
        });

        fitClipToBeats('c1', 8);

        const updater = mocks.updateClip.mock.calls[0]![1] as (c: any) => any;
        const next = updater({
            id: 'c1',
            startBeat: 0,
            endBeat: 4,
            stretchRatio: 1,
            stretchMode: 'stretch' as const,
        });

        expect(next.stretchMode).toBe('stretch');
    });
});
