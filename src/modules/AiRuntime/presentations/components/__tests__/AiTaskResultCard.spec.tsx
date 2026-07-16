import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { AiTaskResultCard } from '../AiTaskResultCard';

const { onRemoveMock } = vi.hoisted(() => ({ onRemoveMock: vi.fn() }));

describe('AiTaskResultCard', () => {
    it('should render task type and remove on click', () => {
        onRemoveMock.mockClear();
        const task = {
            id: 't1',
            type: 'audio-generation',
            status: 'processing',
            timestamp: Date.now(),
            prompt: 'Make a beat',
        } satisfies Parameters<typeof AiTaskResultCard>[0]['task'];
        render(<AiTaskResultCard task={task} onRemove={onRemoveMock} />);
        expect(screen.getByText(/audio generation/i)).toBeInTheDocument();
        expect(screen.getByText(/Make a beat/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove task' }));
        expect(onRemoveMock).toHaveBeenCalledWith('t1');
    });
});
