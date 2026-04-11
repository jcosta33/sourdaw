import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatComposer } from '../ChatComposer';

describe('ChatComposer', () => {
    it('should render', () => {
        const textareaRef = createRef<HTMLTextAreaElement>();
        render(
            <ChatComposer
                chatMode="chat"
                enableReasoning={false}
                isGenerating={false}
                inputValue="hello"
                isLlmAvailable
                textareaRef={textareaRef}
                onChange={vi.fn()}
                onKeyDown={vi.fn()}
                onToggleMode={vi.fn()}
                onToggleReasoning={vi.fn()}
                onSend={vi.fn()}
                onStop={vi.fn()}
            />
        );
        expect(screen.getByRole('textbox')).toHaveValue('hello');
        fireEvent.click(screen.getByRole('button', { name: /command mode/i }));
    });
});
