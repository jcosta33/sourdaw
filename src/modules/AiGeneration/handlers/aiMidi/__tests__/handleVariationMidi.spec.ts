import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleVariationMidi } from '../handleVariationMidi';

const mocks = vi.hoisted(() => ({
    getNotesForClip: vi.fn(),
    setNotesForClip: vi.fn(),
    createMidiNote: vi.fn((pitch, startBeat, duration, velocity) => ({ pitch, startBeat, duration, velocity })),
    generateToolCalls: vi.fn(),
    llmGenerateNotes: vi.fn(),
    info: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: mocks.getNotesForClip,
    setNotesForClip: mocks.setNotesForClip,
    createMidiNote: mocks.createMidiNote,
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
    });

    it('generates a variation and replaces clip notes', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 1 }]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 64, startBeat: 0, duration: 1, velocity: 80 }]);

        await handleVariationMidi.execute({
            type: 'variationMidi',
            payload: { clipId: 'c1', amount: 0.5 },
        });

        // Should call LLM with ~50%
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('50%'),
            [{ pitch: 60, startBeat: 0, duration: 1 }],
            'c1'
        );

        // Sets the notes, creating MIDI note domain models
        expect(mocks.createMidiNote).toHaveBeenCalledWith(64, 0, 1, 80);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', [
            { pitch: 64, startBeat: 0, duration: 1, velocity: 80 },
        ]);
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Generated variation'));
    });

    it('defaults to 30% variation if amount is not provided', async () => {
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.llmGenerateNotes.mockResolvedValue([]);

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

    it('provides a description', () => {
        const desc = handleVariationMidi.describe({
            type: 'variationMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('AI: create MIDI variation');
    });

    it('is undoable', () => {
        expect(handleVariationMidi.undoable).toBe(true);
    });
});
