import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type CommittedClipActions, AiTaskResultCard } from '../AiTaskResultCard';

function task(overrides: Record<string, unknown> = {}) {
    return {
        id: 't1',
        type: 'denoise',
        status: 'processing',
        timestamp: Date.now(),
        ...overrides,
    } as Parameters<typeof AiTaskResultCard>[0]['task'];
}

function clipActions(overrides: Partial<CommittedClipActions> = {}): CommittedClipActions {
    return {
        isPreviewing: false,
        togglePreview: vi.fn(),
        select: vi.fn(),
        ...overrides,
    };
}

describe('AiTaskResultCard', () => {
    it('should render task type and remove on click', () => {
        const onRemoveMock = vi.fn();
        render(<AiTaskResultCard task={task({ prompt: 'Make a beat' })} onRemove={onRemoveMock} />);
        expect(screen.getByText(/denoise/i)).toBeInTheDocument();
        expect(screen.getByText(/Make a beat/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove task result' }));
        expect(onRemoveMock).toHaveBeenCalledWith('t1');
    });
});

describe('AiTaskResultCard — type formatting', () => {
    it('formats midi-generation type as capitalized "midi generation"', () => {
        render(<AiTaskResultCard task={task({ type: 'midi-generation' })} onRemove={vi.fn()} />);
        expect(screen.getByText(/midi generation/i)).toBeTruthy();
    });

    it('formats stem-separation type as "stem separation"', () => {
        render(<AiTaskResultCard task={task({ type: 'stem-separation' })} onRemove={vi.fn()} />);
        expect(screen.getByText(/stem separation/i)).toBeTruthy();
    });
});

describe('AiTaskResultCard — prompt conditional', () => {
    it('renders the prompt text when provided', () => {
        render(<AiTaskResultCard task={task({ prompt: 'Create a melody' })} onRemove={vi.fn()} />);
        expect(screen.getByText(/Create a melody/)).toBeTruthy();
    });

    it('does not render prompt text when absent', () => {
        const { container } = render(<AiTaskResultCard task={task({ prompt: undefined })} onRemove={vi.fn()} />);
        expect(container.querySelector('.italic')).toBeNull();
    });
});

describe('AiTaskResultCard — status branches', () => {
    it('shows Processing text when status is processing', () => {
        render(<AiTaskResultCard task={task({ status: 'processing' })} onRemove={vi.fn()} />);
        expect(screen.getByText('Processing...')).toBeTruthy();
    });

    it('shows the error message when status is error', () => {
        render(<AiTaskResultCard task={task({ status: 'error', error: 'Model timed out' })} onRemove={vi.fn()} />);
        expect(screen.getByText('Model timed out')).toBeTruthy();
    });

    it('shows duration in seconds when status is success and durationMs is set', () => {
        render(<AiTaskResultCard task={task({ status: 'success', durationMs: 3500 })} onRemove={vi.fn()} />);
        expect(screen.getByText('3.5s')).toBeTruthy();
    });

    it('shows Done when status is success and no durationMs', () => {
        render(<AiTaskResultCard task={task({ status: 'success', durationMs: undefined })} onRemove={vi.fn()} />);
        expect(screen.getByText('Done')).toBeTruthy();
    });
});

describe('AiTaskResultCard — committed clip actions', () => {
    it('renders no clip actions when the task carries no actionable clip', () => {
        render(<AiTaskResultCard task={task({ status: 'success', durationMs: 900 })} onRemove={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Preview task result' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stop clip preview' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Select generated clip' })).toBeNull();
    });

    it('offers no Apply affordance for already-committed material', () => {
        render(
            <AiTaskResultCard
                task={task({ status: 'success', durationMs: 900 })}
                onRemove={vi.fn()}
                committedClipActions={clipActions()}
            />
        );
        expect(screen.queryByRole('button', { name: 'Add task result to arrangement' })).toBeNull();
        expect(screen.queryByTitle('Add to arrangement')).toBeNull();
    });

    it('toggles preview through the supplied action', () => {
        const actions = clipActions();
        const { rerender } = render(
            <AiTaskResultCard
                task={task({ status: 'success', durationMs: 900 })}
                onRemove={vi.fn()}
                committedClipActions={actions}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Preview task result' }));
        expect(actions.togglePreview).toHaveBeenCalledOnce();

        rerender(
            <AiTaskResultCard
                task={task({ status: 'success', durationMs: 900 })}
                onRemove={vi.fn()}
                committedClipActions={clipActions({ isPreviewing: true })}
            />
        );
        expect(screen.getByRole('button', { name: 'Stop clip preview' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Preview task result' })).toBeNull();
    });

    it('re-selects the committed clip through the supplied action', () => {
        const actions = clipActions();
        render(
            <AiTaskResultCard
                task={task({ status: 'success', durationMs: 900 })}
                onRemove={vi.fn()}
                committedClipActions={actions}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Select generated clip' }));
        expect(actions.select).toHaveBeenCalledOnce();
    });
});
