import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddClip } from '../handleAddClip';

type AddClipInput = {
    id?: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

const mocks = vi.hoisted(() => ({
    addClip: vi.fn<(input: AddClipInput) => unknown>(),
    serializeMidiStateForClips: vi.fn(() => '{"notesByClipId":{}}'),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: mocks.addClip,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    serializeMidiStateForClips: mocks.serializeMidiStateForClips,
}));

describe('handleAddClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes addClip with the payload', () => {
        mocks.addClip.mockReturnValue({ id: 'clip-1' });
        const payload = {
            trackId: 't1',
            name: 'New Clip',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
            muted: true,
        };

        const result = handleAddClip.execute({ type: 'addClip', payload });

        const input = mocks.addClip.mock.calls[0]?.[0];
        expect(input).toMatchObject(payload);
        expect(input?.id).toMatch(/^clip-/);
        expect(payload).not.toHaveProperty('id');
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when addClip rejects the target track', () => {
        mocks.addClip.mockReturnValue(null);
        const result = handleAddClip.execute({
            type: 'addClip',
            payload: { trackId: 'vca-1', name: 'Rejected', startBeat: 0, endBeat: 4, type: 'audio' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description based on clip name', () => {
        const action = {
            type: 'addClip',
            payload: {
                trackId: 't1',
                name: 'New Clip',
                startBeat: 0,
                endBeat: 4,
                type: 'audio' as const,
            },
        } as const;

        const desc = handleAddClip.describe(action);
        if (desc.redoAction?.type !== 'addClip' || typeof desc.redoAction.payload.id !== 'string') {
            throw new Error('Expected describe to materialize a replay clip id');
        }
        const clipId = desc.redoAction.payload.id;

        expect(desc.label).toBe('Add clip "New Clip"');
        expect(clipId).toMatch(/^clip-/);
        expect(desc.inverseAction).toEqual({
            type: 'discardDuplicatedClip',
            payload: {
                clipId,
                generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'addClip',
            payload: { ...action.payload, id: clipId },
        });
        expect(action.payload).not.toHaveProperty('id');
    });

    it('reuses the command-owned clip id during execution', async () => {
        mocks.addClip.mockReturnValue({ id: 'clip-stable' });
        const action = {
            type: 'addClip' as const,
            payload: { trackId: 't1', name: 'Stable', startBeat: 0, endBeat: 4, type: 'midi' as const },
        };

        handleAddClip.describe(action);
        await handleAddClip.execute(action);

        const input = mocks.addClip.mock.calls[0]?.[0];
        expect(input?.id).toMatch(/^clip-/);
        expect(input?.name).toBe('Stable');
    });

    it('guards undo against changes to the created clip and its MIDI state', async () => {
        const createdClip = {
            id: 'clip-stable',
            trackId: 't1',
            name: 'Stable',
            startBeat: 0,
            endBeat: 4,
            type: 'midi' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        mocks.addClip.mockImplementation((input) => ({ ...createdClip, id: input.id! }));
        const action = {
            type: 'addClip' as const,
            payload: { trackId: 't1', name: 'Stable', startBeat: 0, endBeat: 4, type: 'midi' as const },
        };

        const desc = handleAddClip.describe(action);
        await handleAddClip.execute(action);
        const createdId = mocks.addClip.mock.calls[0]![0].id!;
        const materializedClip = { ...createdClip, id: createdId };

        expect(desc.inverseAction).toEqual({
            type: 'discardDuplicatedClip',
            payload: {
                clipId: createdId,
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify(materializedClip),
                    midiByClipIdJson: '{"notesByClipId":{}}',
                },
            },
        });
        expect(mocks.serializeMidiStateForClips).toHaveBeenCalledWith([createdId]);
    });

    it('is undoable', () => {
        expect(handleAddClip.undoable).toBe(true);
        expect(handleAddClip.requiresAbortCompensation).toBe(false);
    });
});
