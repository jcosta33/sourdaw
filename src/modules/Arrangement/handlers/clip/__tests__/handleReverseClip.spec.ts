import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleReverseClip } from '../handleReverseClip';

const mocks = vi.hoisted(() => ({
    reverseClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    captureClipPitchAnalysis: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/reverseClip', () => ({
    reverseClip: mocks.reverseClip,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('#/modules/Knead/useCases', () => ({ captureClipPitchAnalysis: mocks.captureClipPitchAnalysis }));

describe('handleReverseClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reverseClip.mockReturnValue(true);
        mocks.captureClipPitchAnalysis.mockReturnValue({});
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', name: 'Verse', audioBufferId: 'buffer-1' }],
                },
            ],
        });
    });

    it('executes reverseClip with the application-resolved buffer id', () => {
        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });

        expect(mocks.reverseClip).toHaveBeenCalledWith('c1', 'reversed-command-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when reversal is rejected', () => {
        mocks.reverseClip.mockReturnValue(false);

        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'vca-clip', reversedBufferId: 'reversed-command-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('describes a snapshot restore, not a second reverse', () => {
        mocks.captureClipPitchAnalysis.mockReturnValue({
            blobs: [{ id: 'b1', pitchCurveCents: [1, 2] }],
            contour: { points: [{ time: 0 }], sample_rate: 48000, hop_size: 256 },
        });

        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });

        // Reversing again would mint a third buffer, append a second " (reversed)" and
        // clear the pitch analysis for good. The inverse restores all three instead.
        expect(description.inverseAction).toEqual({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'reversed-command-1',
                audioBufferId: 'buffer-1',
                name: 'Verse',
                blobs: [{ id: 'b1', pitchCurveCents: [1, 2] }],
                contour: { points: [{ time: 0 }], sample_rate: 48000, hop_size: 256 },
            },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'buffer-1',
                audioBufferId: 'reversed-command-1',
                name: 'Verse (reversed)',
            },
        });
    });

    it('emits no inverse without a resolved buffer id', () => {
        expect(handleReverseClip.describe({ type: 'reverseClip', payload: { clipId: 'c1' } })).toEqual({
            label: 'Reverse clip',
            inverseAction: null,
        });
    });

    it('emits no inverse for a clip that carries no audio buffer', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'midi', name: 'Verse' }] }],
        });

        expect(
            handleReverseClip.describe({
                type: 'reverseClip',
                payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
            })
        ).toEqual({ label: 'Reverse clip', inverseAction: null });
    });

    it('is undoable', () => {
        expect(handleReverseClip.undoable).toBe(true);
    });
});
