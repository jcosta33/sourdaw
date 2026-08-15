import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
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
});
