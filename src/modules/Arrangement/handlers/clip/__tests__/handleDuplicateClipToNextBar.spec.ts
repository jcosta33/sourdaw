import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClipToNextBar } from '../handleDuplicateClipToNextBar';

const mocks = vi.hoisted(() => ({
    duplicateClipToNextBar: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'clip-copy'),
    resolveEligibleClipWriteTarget: vi.fn(),
    getTrackStoreState: vi.fn(),
    serializeMidiStateForClips: vi.fn(() => '{"notesByClipId":{}}'),
}));

vi.mock('../../../useCases/clip/duplicateClipToNextBar', () => ({
    duplicateClipToNextBar: mocks.duplicateClipToNextBar,
}));

vi.mock('../../../useCases/clip/prepareDuplicateClipTargetId', () => ({
    prepareDuplicateClipTargetId: mocks.prepareDuplicateClipTargetId,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    serializeMidiStateForClips: mocks.serializeMidiStateForClips,
}));

describe('handleDuplicateClipToNextBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.duplicateClipToNextBar.mockReturnValue(true);
        mocks.serializeMidiStateForClips.mockReturnValue('{"notesByClipId":{}}');
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'missing' };
        });
    });

    it('executes duplicateClipToNextBar with the provided payload and target clip id', () => {
        expect(
            handleDuplicateClipToNextBar.execute({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'written' });

        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-provided' });
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('should prepare a reversible duplicate-to-next-bar action when no target clip id is provided', () => {
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1' },
        };

        const desc = handleDuplicateClipToNextBar.describe(action);
        void handleDuplicateClipToNextBar.execute(action);

        expect(desc).toEqual({
            label: 'Duplicate clip to next bar',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: 'clip-copy', generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
            },
        });
        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-copy' });
    });

    it('provides a description', () => {
        const desc = handleDuplicateClipToNextBar.describe({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip to next bar');
    });

    it('stamps the inverse guard with the duplicated clip and its MIDI state after execution', () => {
        const duplicatedClip = {
            id: 'clip-copy',
            trackId: 't1',
            name: 'Test Clip (copy)',
            startBeat: 4,
            endBeat: 8,
            type: 'audio' as const,
            audioBufferId: 'buffer-1',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ff0000',
            locked: false,
            muted: false,
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [duplicatedClip] }],
            selectedTrackId: 't1',
            ghostClips: [],
        });
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1', targetClipId: 'clip-copy' },
        };

        const desc = handleDuplicateClipToNextBar.describe(action);
        handleDuplicateClipToNextBar.execute(action);

        expect(desc.inverseAction).toEqual({
            type: 'discardDuplicatedClip',
            payload: {
                clipId: 'clip-copy',
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify(duplicatedClip),
                    midiByClipIdJson: '{"notesByClipId":{}}',
                },
            },
        });
        expect(mocks.serializeMidiStateForClips).toHaveBeenCalledWith(['clip-copy']);
    });

    it('is undoable', () => {
        expect(handleDuplicateClipToNextBar.undoable).toBe(true);
    });

    it('rejects before describe can allocate a target id when the source is ineligible', () => {
        const action = { type: 'duplicateClipToNextBar' as const, payload: { clipId: 'vca-clip' } };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        expect(handleDuplicateClipToNextBar.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClipToNextBar).not.toHaveBeenCalled();
    });

    it('rejects an existing explicit target before describe can attach its inverse', () => {
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1', targetClipId: 'existing-clip' },
        };
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 't1' };
        });

        expect(handleDuplicateClipToNextBar.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClipToNextBar).not.toHaveBeenCalled();
    });

    it('reports no-write when the prepared duplicate is not published', () => {
        mocks.duplicateClipToNextBar.mockReturnValue(false);

        expect(
            handleDuplicateClipToNextBar.execute({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'no-write' });
    });

    it('is a noop when the destination track is ineligible for a clip add', () => {
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            // Destination track lookup fails.
            return { status: 'ineligible' };
        });

        expect(
            handleDuplicateClipToNextBar.isNoop?.({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1' },
            })
        ).toBe(true);
    });

    it('is a noop when an explicit target clip id is the empty string', () => {
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'missing' };
        });

        expect(
            handleDuplicateClipToNextBar.isNoop?.({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1', targetClipId: '' },
            })
        ).toBe(true);
    });

    it('is not a noop when no explicit target is given and everything is eligible', () => {
        expect(
            handleDuplicateClipToNextBar.isNoop?.({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1' },
            })
        ).toBe(false);
    });
});
