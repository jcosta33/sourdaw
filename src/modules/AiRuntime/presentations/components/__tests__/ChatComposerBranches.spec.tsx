import { createRef } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChatComposer } from '../ChatComposer';

/**
 * Deep branch specs for ChatComposer. The existing spec (1 test) only checks
 * textbox value. These cover: placeholder text (3 states), action button
 * (icon/disabled/onClick wiring), toggle buttons (disabled/onClick), textarea
 * disabled state, and onChange.
 */

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        executionMode: 'explain' as const,
        executionModes: ['explain', 'plan', 'preview', 'apply', 'macro'] as const,
        enableReasoning: false,
        isGenerating: false,
        inputValue: '',
        isLlmAvailable: true,
        textareaRef: createRef<HTMLTextAreaElement>(),
        onChange: vi.fn(),
        onKeyDown: vi.fn(),
        onExecutionModeChange: vi.fn(),
        onToggleReasoning: vi.fn(),
        onSend: vi.fn(),
        onStop: vi.fn(),
        ...overrides,
    };
}

describe('ChatComposer — placeholder text', () => {
    it('shows default placeholder when not generating and in chat mode', () => {
        render(<ChatComposer {...defaultProps()} />);
        expect(screen.getByRole('textbox')).toHaveAttribute(
            'placeholder',
            'Send a message... (Shift+Enter for newline)'
        );
    });

    it('shows "AI is thinking..." when generating', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true })} />);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'AI is thinking...');
    });

    it('shows command-mode placeholder for a write-capable mode', () => {
        render(<ChatComposer {...defaultProps({ executionMode: 'apply' })} />);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Type a command to execute or generate...');
    });

    it('generating placeholder takes priority over execution mode', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true, executionMode: 'apply' })} />);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'AI is thinking...');
    });
});

describe('ChatComposer — textarea disabled state', () => {
    it('disables textarea when generating', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true })} />);
        expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('disables textarea when LLM is not available', () => {
        render(<ChatComposer {...defaultProps({ isLlmAvailable: false })} />);
        expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('enables textarea when not generating and LLM is available', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: false, isLlmAvailable: true })} />);
        expect(screen.getByRole('textbox')).toBeEnabled();
    });
});

describe('ChatComposer — onChange', () => {
    it('fires onChange with the new value when typing', () => {
        const onChange = vi.fn();
        render(<ChatComposer {...defaultProps({ onChange })} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } });
        expect(onChange).toHaveBeenCalledWith('hello world');
    });
});

describe('ChatComposer — action button (Send/Stop)', () => {
    it('disables send button when input is empty', () => {
        render(<ChatComposer {...defaultProps({ inputValue: '' })} />);
        const buttons = screen.getAllByRole('button');
        // The action button is the last one (after Command Mode and Think toggles).
        expect(buttons[buttons.length - 1]).toBeDisabled();
    });

    it('enables send button when input has text and LLM is available', () => {
        render(<ChatComposer {...defaultProps({ inputValue: 'hello', isLlmAvailable: true })} />);
        const buttons = screen.getAllByRole('button');
        // The action button is the last one (after Command Mode and Think toggles).
        const sendButton = buttons[buttons.length - 1]!;
        expect(sendButton).toBeEnabled();
    });

    it('disables send button when LLM is not available', () => {
        render(<ChatComposer {...defaultProps({ inputValue: 'hello', isLlmAvailable: false })} />);
        const buttons = screen.getAllByRole('button');
        const sendButton = buttons[buttons.length - 1]!;
        expect(sendButton).toBeDisabled();
    });

    it('calls onSend when clicked (not generating)', () => {
        const onSend = vi.fn();
        render(<ChatComposer {...defaultProps({ inputValue: 'hello', onSend })} />);
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[buttons.length - 1]!);
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('calls onStop when clicked (generating)', () => {
        const onStop = vi.fn();
        render(<ChatComposer {...defaultProps({ isGenerating: true, onStop })} />);
        const buttons = screen.getAllByRole('button');
        // When generating, the action button should call onStop, not onSend.
        fireEvent.click(buttons[buttons.length - 1]!);
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('action button is enabled when generating (to allow stop)', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true, inputValue: '' })} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons[buttons.length - 1]!).toBeEnabled();
    });
});

describe('ChatComposer — mode and toggle controls', () => {
    it('reports an explicit execution mode selection', () => {
        const onExecutionModeChange = vi.fn();
        render(<ChatComposer {...defaultProps({ onExecutionModeChange })} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Agent execution mode' }), {
            target: { value: 'preview' },
        });
        expect(onExecutionModeChange).toHaveBeenCalledWith('preview');
    });

    it('Think toggle fires onToggleReasoning', () => {
        const onToggleReasoning = vi.fn();
        render(<ChatComposer {...defaultProps({ onToggleReasoning })} />);
        fireEvent.click(screen.getByRole('button', { name: /think/i }));
        expect(onToggleReasoning).toHaveBeenCalledTimes(1);
    });

    it('execution mode selection is disabled when generating', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true })} />);
        expect(screen.getByRole('combobox', { name: 'Agent execution mode' })).toBeDisabled();
    });

    it('Think toggle is disabled when generating', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true })} />);
        expect(screen.getByRole('button', { name: /think/i })).toBeDisabled();
    });
});

describe('ChatComposer — button title attributes', () => {
    it('action button has no title when not generating', () => {
        render(<ChatComposer {...defaultProps({ inputValue: 'hello' })} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons[buttons.length - 1]).not.toHaveAttribute('title');
    });

    it('action button has "Stop Generation" title when generating', () => {
        render(<ChatComposer {...defaultProps({ isGenerating: true })} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons[buttons.length - 1]).toHaveAttribute('title', 'Stop Generation');
    });
});
