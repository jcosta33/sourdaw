import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiTaskResultCard } from '../AiTaskResultCard';
import { type AiTaskResult } from '#/modules/AiGeneration/stores/aiStore';

const { removeTaskMock } = vi.hoisted(() => ({ removeTaskMock: vi.fn() }));

vi.mock('#/modules/AiGeneration/useCases/actions/removeTask', () => ({
    removeTask: removeTaskMock,
}));

describe('AiTaskResultCard', () => {
    it('should render task type and remove on click', () => {
        removeTaskMock.mockClear();
        const task: AiTaskResult = {
            id: 't1',
            type: 'audio-generation',
            status: 'processing',
            timestamp: Date.now(),
            prompt: 'Make a beat',
        };
        render(<AiTaskResultCard task={task} />);
        expect(screen.getByText(/audio generation/i)).toBeInTheDocument();
        expect(screen.getByText(/Make a beat/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove task' }));
        expect(removeTaskMock).toHaveBeenCalledWith('t1');
    });
});
