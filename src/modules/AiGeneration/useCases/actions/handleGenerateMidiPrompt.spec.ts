import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleGenerateMidiPrompt } from './handleGenerateMidiPrompt';

describe('handleGenerateMidiPrompt', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('records an error task when generation yields no notes', async () => {
        const addTask = vi.fn().mockReturnValue('task-1');
        const updateTask = vi.fn();
        injectDependencies(handleGenerateMidiPrompt, {
            generateMidiAI: vi.fn(),
            isTauri: () => false,
            addTrack: vi.fn(),
            addClip: vi.fn(),
            batchAddMidiNotes: vi.fn(),
            getTransportState: vi.fn(),
            createCallbackUndoEntry: vi.fn(),
            generateMidiViaLlm: vi.fn().mockResolvedValue([]),
            addTask,
            updateTask,
        });

        await handleGenerateMidiPrompt('hello');

        expect(updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
