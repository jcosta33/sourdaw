import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleVariationMidi } from '../handleVariationMidi';

const mocks = vi.hoisted(() => {
    const transactionScope = vi.fn((callback: () => void) => callback());
    return {
        captureTransactionScope: vi.fn(() => transactionScope),
        transactionScope,
        getTrackStoreState: vi.fn(),
        getNotesForClip: vi.fn(),
        setNotesForClip: vi.fn(),
        createMidiNote: vi.fn((pitch: number, startBeat: number, duration: number, velocity: number) => ({
            id: 'generated-note',
            pitch,
            startBeat,
            duration,
            velocity,
            probability: 100,
        })),
        generateToolCalls: vi.fn(),
        llmGenerateNotes: vi.fn(),
        info: vi.fn(),
    };
});

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    captureAutomergeStorageTransactionScope: mocks.captureTransactionScope,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: mocks.getNotesForClip,
    setNotesForClip: mocks.setNotesForClip,
    createMidiNote: mocks.createMidiNote,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    generateToolCalls: mocks.generateToolCalls,
}));

vi.mock('../llmNoteHelpers', () => ({
    llmGenerateNotes: mocks.llmGenerateNotes,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleVariationMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' }] }],
        });
    });

    it('generates a variation and replaces clip notes', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 64, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleVariationMidi.execute({
            type: 'variationMidi',
            payload: { clipId: 'c1', amount: 0.5 },
        });

        // Should call LLM with ~50%
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('50%'),
            existing,
            'c1'
        );

        // Sets the notes, creating MIDI note domain models
        expect(mocks.createMidiNote).toHaveBeenCalledWith(64, 0, 1, 80);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', [
            { id: 'generated-note', pitch: 64, startBeat: 0, duration: 1, velocity: 80, probability: 100 },
        ]);
        expect(mocks.captureTransactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.transactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.captureTransactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.llmGenerateNotes.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.transactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.setNotesForClip.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.info).not.toHaveBeenCalled();
        if (result?.status !== 'written') {
            throw new Error('Expected a written variation result');
        }
        await result.afterCommit?.();
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Generated variation'));
    });

    it('defaults to 30% variation if amount is not provided', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c2', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' }] }],
        });
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 60, startBeat: 0, duration: 1 }]);

        await handleVariationMidi.execute({
            type: 'variationMidi',
            payload: { clipId: 'c2' },
        });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('30%'),
            [],
            'c2'
        );
    });

    it('does not replace clip notes when generated output is rejected', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockRejectedValue(new Error('Invalid generated MIDI notes'));

        await expect(
            handleVariationMidi.execute({
                type: 'variationMidi',
                payload: { clipId: 'c1' },
            })
        ).rejects.toThrow('Invalid generated MIDI notes');

        expect(mocks.createMidiNote).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.transactionScope).not.toHaveBeenCalled();
    });

    it('returns a conflict without replacing notes when the source changes during inference', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getTrackStoreState
            .mockReturnValueOnce({
                tracks: [{ id: 't1', clips: [{ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' }] }],
            })
            .mockReturnValueOnce({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 64, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleVariationMidi.execute({
            type: 'variationMidi',
            payload: { clipId: 'c1' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.createMidiNote).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.transactionScope).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        const desc = handleVariationMidi.describe({
            type: 'variationMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('AI: create MIDI variation');
        expect(desc.inverseAction).toEqual({
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'c1',
                notes: existing,
                expectedNotes: [],
            },
        });
    });

    it('replays the exact variation without invoking the model again', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 64, startBeat: 0, duration: 1, velocity: 80 }]);
        const action = { type: 'variationMidi' as const, payload: { clipId: 'c1', amount: 0.5 } };
        const description = handleVariationMidi.describe(action);

        await handleVariationMidi.execute(action);
        await handleVariationMidi.execute(action);

        expect(mocks.llmGenerateNotes).toHaveBeenCalledTimes(1);
        expect(mocks.setNotesForClip).toHaveBeenLastCalledWith('c1', [
            {
                id: 'generated-note',
                pitch: 64,
                startBeat: 0,
                duration: 1,
                velocity: 80,
                probability: 100,
            },
        ]);
        expect(description.inverseAction).toEqual({
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'c1',
                notes: existing,
                expectedNotes: [
                    {
                        id: 'generated-note',
                        pitch: 64,
                        startBeat: 0,
                        duration: 1,
                        velocity: 80,
                        probability: 100,
                    },
                ],
            },
        });
    });

    it('is undoable', () => {
        expect(handleVariationMidi.undoable).toBe(true);
    });
});
