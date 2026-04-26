import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCompleteMidi } from '../handleCompleteMidi';

const mocks = vi.hoisted(() => ({
    getNotesForClip: vi.fn(),
    addMidiNote: vi.fn(),
    generateToolCalls: vi.fn(),
    llmGenerateNotes: vi.fn(),
    info: vi.fn(),
    addClip: vi.fn(),
    trackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 4, name: 'Lead', type: 'midi' }
                    ]
                }
            ]
        }
    }
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addClip: mocks.addClip,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: mocks.getNotesForClip,
    addMidiNote: mocks.addMidiNote,
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateToolCalls: mocks.generateToolCalls,
}));

vi.mock('../llmNoteHelpers', () => ({
    llmGenerateNotes: mocks.llmGenerateNotes,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleCompleteMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generates forward completion notes', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 4 }]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 4, duration: 1, velocity: 90 }]);

        await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', bars: 2, direction: 'forward' },
        });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('Continue'),
            [{ pitch: 60, startBeat: 0, duration: 4 }],
            'c1'
        );

        expect(mocks.addMidiNote).toHaveBeenCalledWith('c1', 62, 4, 1, 90);
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Completed 1 notes'));
    });

    it('generates backward lead-in notes on a new prepended clip', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 4 }]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 58, startBeat: -4, duration: 1, velocity: 80 }]);
        mocks.addClip.mockReturnValue({ id: 'new-clip-id' });

        await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', bars: 1, direction: 'backward' },
        });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('BEFORE'),
            [{ pitch: 60, startBeat: 0, duration: 4 }],
            'c1'
        );

        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({
            trackId: 't1',
            startBeat: 0, // max(0, 4 - 4)
            endBeat: 4,
            name: 'Lead (intro)'
        }));
        
        // Note is shifted relative to its minimum startBeat (-4)
        // Shifted start = -4 - (-4) = 0
        expect(mocks.addMidiNote).toHaveBeenCalledWith('new-clip-id', 58, 0, 1, 80);
    });

    it('provides a description', () => {
        const desc = handleCompleteMidi.describe({
            type: 'completeMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('AI: complete MIDI phrase');
    });

    it('is undoable', () => {
        expect(handleCompleteMidi.undoable).toBe(true);
    });
});
