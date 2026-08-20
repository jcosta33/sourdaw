import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClip } from '../handleDuplicateClip';

const mocks = vi.hoisted(() => ({
    duplicateClip: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'clip-copy'),
    resolveEligibleClipWriteTarget: vi.fn(),
    getTrackStoreState: vi.fn(),
    serializeMidiStateForClips: vi.fn(() => '{"notesByClipId":{}}'),
}));

vi.mock('../../../useCases/clip/duplicateClip', () => ({
    duplicateClip: mocks.duplicateClip,
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

describe('handleDuplicateClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.duplicateClip.mockReturnValue(true);
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

    it('executes duplicateClip with the provided payload and target clip id', () => {
        expect(
            handleDuplicateClip.execute({
                type: 'duplicateClip',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'written' });

        expect(mocks.duplicateClip).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-provided' });
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('should prepare a reversible duplicate action when no target clip id is provided', () => {
        const action = {
            type: 'duplicateClip' as const,
            payload: { clipId: 'c1' },
        };

        const desc = handleDuplicateClip.describe(action);
        void handleDuplicateClip.execute(action);

        expect(desc).toEqual({
            label: 'Duplicate clip',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: 'clip-copy', generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
            },
        });
        expect(mocks.duplicateClip).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-copy' });
    });

    it('provides a description', () => {
        const desc = handleDuplicateClip.describe({
            type: 'duplicateClip',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip');
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
            type: 'duplicateClip' as const,
            payload: { clipId: 'c1', targetClipId: 'clip-copy' },
        };

        const desc = handleDuplicateClip.describe(action);
        handleDuplicateClip.execute(action);

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
        expect(handleDuplicateClip.undoable).toBe(true);
    });

    it('rejects before describe can allocate a target id when the source is ineligible', () => {
        const action = { type: 'duplicateClip' as const, payload: { clipId: 'vca-clip' } };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        expect(handleDuplicateClip.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClip).not.toHaveBeenCalled();
    });

    it('rejects an existing explicit target before describe can attach its inverse', () => {
        const action = {
            type: 'duplicateClip' as const,
            payload: { clipId: 'c1', targetClipId: 'existing-clip' },
        };
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 't1' };
        });

        expect(handleDuplicateClip.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClip).not.toHaveBeenCalled();
    });

    it('reports no-write when the prepared duplicate is not published', () => {
        mocks.duplicateClip.mockReturnValue(false);

        expect(
            handleDuplicateClip.execute({
                type: 'duplicateClip',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'no-write' });
    });

    it('is a noop when the destination track is ineligible', () => {
        const action = { type: 'duplicateClip' as const, payload: { clipId: 'c1' } };
        // Source resolves eligible on track t1, but the destination target is ineligible.
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            return { status: 'ineligible' };
        });

        expect(handleDuplicateClip.isNoop?.(action)).toBe(true);
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('is not a noop and allocates a fresh target id when none is supplied', () => {
        const action = { type: 'duplicateClip' as const, payload: { clipId: 'c1' } };

        expect(handleDuplicateClip.isNoop?.(action)).toBe(false);
    });

    it('is a noop when an explicit empty target clip id is supplied', () => {
        const action = { type: 'duplicateClip' as const, payload: { clipId: 'c1', targetClipId: '' } };

        expect(handleDuplicateClip.isNoop?.(action)).toBe(true);
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });
});
