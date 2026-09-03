import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChatComposer } from '../ChatComposer';

describe('ChatComposer', () => {
    it('should render', () => {
        const textareaRef = createRef<HTMLTextAreaElement>();
        render(
            <ChatComposer
                executionMode="explain"
                executionModes={['explain', 'plan', 'preview', 'apply', 'macro']}
                enableReasoning={false}
                isGenerating={false}
                inputValue="hello"
                isLlmAvailable
                textareaRef={textareaRef}
                onChange={vi.fn()}
                onKeyDown={vi.fn()}
                onExecutionModeChange={vi.fn()}
                onToggleReasoning={vi.fn()}
                onSend={vi.fn()}
                onStop={vi.fn()}
            />
        );
        expect(screen.getByRole('textbox')).toHaveValue('hello');
        expect(screen.getByRole('combobox', { name: 'Agent execution mode' })).toHaveValue('explain');
    });

    it('renders mode select with DawCompactSelect classes and handles mode change', () => {
        const textareaRef = createRef<HTMLTextAreaElement>();
        const onExecutionModeChange = vi.fn();
        render(
            <ChatComposer
                executionMode="explain"
                executionModes={['explain', 'plan', 'preview', 'apply', 'macro']}
                enableReasoning={false}
                isGenerating={false}
                inputValue=""
                isLlmAvailable
                textareaRef={textareaRef}
                onChange={vi.fn()}
                onKeyDown={vi.fn()}
                onExecutionModeChange={onExecutionModeChange}
                onToggleReasoning={vi.fn()}
                onSend={vi.fn()}
                onStop={vi.fn()}
            />
        );

        const select = screen.getByRole('combobox', { name: 'Agent execution mode' });
        expect(select).toBeInTheDocument();
        expect(select).toHaveClass('h-5', 'bg-surface-inset');

        fireEvent.change(select, { target: { value: 'apply' } });
        expect(onExecutionModeChange).toHaveBeenCalledWith('apply');
    });
});
