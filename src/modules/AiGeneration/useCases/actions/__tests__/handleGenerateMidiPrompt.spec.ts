import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGenerateMidiPrompt } from '../handleGenerateMidiPrompt';

const { updateTaskMock } = vi.hoisted(() => ({
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        generateMidiAI: vi.fn(),
        isTauri: () => false,
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        addTrack: vi.fn(),
        addClip: vi.fn(),
    };
});

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        batchAddMidiNotes: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        createCallbackUndoEntry: vi.fn(),
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        getTransportState: vi.fn(),
    };
});

vi.mock('../../llmMidiGeneration', () => ({
    generateMidiViaLlm: vi.fn().mockResolvedValue([]),
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleGenerateMidiPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records an error task when generation yields no notes', async () => {
        await handleGenerateMidiPrompt('hello');

        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
