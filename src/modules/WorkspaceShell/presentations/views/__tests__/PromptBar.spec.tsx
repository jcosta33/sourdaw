import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { toggleAiHistoryPanel } from '#/modules/AiRuntime/useCases';

import { type PromptExecutionState } from '../../hooks/usePromptExecution';
import { PromptBar } from '../PromptBar';

const module_mocks = vi.hoisted(() => ({
    toggle_ai_history_panel: vi.fn<() => void>(),
    set_value: vi.fn<(value: string) => void>(),
    set_is_focused: vi.fn<(value: boolean) => void>(),
    handle_key_down: vi.fn(),
    handle_submit: vi.fn((event: { preventDefault: () => void }) => {
        event.preventDefault();
    }),
    execute_preset: vi.fn(),
    confirm_preview: vi.fn(),
    cancel_preview: vi.fn(),
    cancel_processing: vi.fn(),
    handle_load_model: vi.fn(),
    dismiss_tag: vi.fn(),
    use_prompt_execution: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn(() => ({ tracks: [] })) }));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    toggleAiHistoryPanel: module_mocks.toggle_ai_history_panel,
}));

vi.mock('../../hooks/usePromptExecution', () => ({
    usePromptExecution: module_mocks.use_prompt_execution,
}));

vi.mock('../Prompt/LlmStatusBadge', () => ({
    LlmStatusBadge: ({ status }: { status: { state: string } }) => (
        <div data-testid="llm-status-badge" data-state={status.state} />
    ),
}));

const basePromptState: PromptExecutionState = {
    value: '',
    setValue: module_mocks.set_value,
    isProcessing: false,
    preview: null,
    selectionTags: [],
    fuzzyResults: [],
    selectedIndex: -1,
    isFocused: false,
    setIsFocused: module_mocks.set_is_focused,
    willUseLlm: false,
    inputRef: { current: null },
    formRef: { current: null },
    llmStatus: { state: 'idle' },
    handleKeyDown: module_mocks.handle_key_down,
    handleSubmit: module_mocks.handle_submit,
    executePreset: module_mocks.execute_preset,
    confirmPreview: module_mocks.confirm_preview,
    cancelPreview: module_mocks.cancel_preview,
    cancelProcessing: module_mocks.cancel_processing,
    handleLoadModel: module_mocks.handle_load_model,
    dismissTag: module_mocks.dismiss_tag,
};

const setPromptState = (overrides: Partial<PromptExecutionState>): void => {
    module_mocks.use_prompt_execution.mockReturnValue({ ...basePromptState, ...overrides });
};

describe('PromptBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setPromptState({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('idle input state', () => {
        it('shows the idle placeholder and lightning icon when the AI will not be used', () => {
            render(<PromptBar />);

            expect(screen.getByPlaceholderText('Type a command... (⌘K for palette)')).toBeInTheDocument();
            expect(screen.queryByLabelText('Cancel AI processing')).not.toBeInTheDocument();
        });

        it('shows the brain icon and does not disable the input when the prompt will use the LLM', () => {
            setPromptState({ willUseLlm: true });

            render(<PromptBar />);

            const input = screen.getByLabelText('Prompt command input');
            expect(input).not.toBeDisabled();
        });

        it('shows the selection-tag placeholder when selection tags are present', () => {
            setPromptState({
                selectionTags: [{ id: 'track:1', label: 'Kick', kind: 'track', icon: 'track' }],
            });

            render(<PromptBar />);

            expect(screen.getByPlaceholderText('What do you want to do with this?')).toBeInTheDocument();
        });
    });

    describe('processing state', () => {
        it('replaces the mode icon with a cancel-processing button and disables the input', () => {
            setPromptState({ isProcessing: true, llmStatus: { state: 'generating' } });

            render(<PromptBar />);

            expect(screen.getByLabelText('Cancel AI processing')).toBeInTheDocument();
            expect(screen.getByLabelText('Prompt command input')).toBeDisabled();
            expect(screen.getByPlaceholderText('AI is thinking...')).toBeInTheDocument();
        });

        it('shows the generic processing placeholder when the LLM is not yet generating', () => {
            setPromptState({ isProcessing: true, llmStatus: { state: 'idle' } });

            render(<PromptBar />);

            expect(screen.getByPlaceholderText('Processing...')).toBeInTheDocument();
        });

        it('calls cancelProcessing when the cancel-processing button is clicked', () => {
            setPromptState({ isProcessing: true });

            render(<PromptBar />);
            fireEvent.click(screen.getByLabelText('Cancel AI processing'));

            expect(module_mocks.cancel_processing).toHaveBeenCalledTimes(1);
        });
    });

    describe('preview mode', () => {
        it('renders the action labels and hides the normal input form', () => {
            setPromptState({
                preview: {
                    actions: [],
                    actionLabels: ['Mute Track 1', 'Set BPM to 120'],
                    rawText: 'mute track 1 and set bpm to 120',
                    requiresConfirmation: true,
                    projectRevision: 'revision-1',
                },
            });

            render(<PromptBar />);

            expect(screen.getByText('Mute Track 1')).toBeInTheDocument();
            expect(screen.getByText('Set BPM to 120')).toBeInTheDocument();
            expect(screen.queryByLabelText('Prompt command input')).not.toBeInTheDocument();
        });

        it('calls confirmPreview when the confirm button is clicked', () => {
            setPromptState({
                preview: {
                    actions: [],
                    actionLabels: ['Do thing'],
                    rawText: 'do thing',
                    requiresConfirmation: true,
                    projectRevision: 'revision-1',
                },
            });

            render(<PromptBar />);
            fireEvent.click(screen.getByLabelText('Confirm actions'));

            expect(module_mocks.confirm_preview).toHaveBeenCalledTimes(1);
        });

        it('calls cancelPreview when the cancel button is clicked', () => {
            setPromptState({
                preview: {
                    actions: [],
                    actionLabels: ['Do thing'],
                    rawText: 'do thing',
                    requiresConfirmation: true,
                    projectRevision: 'revision-1',
                },
            });

            render(<PromptBar />);
            fireEvent.click(screen.getByLabelText('Cancel actions'));

            expect(module_mocks.cancel_preview).toHaveBeenCalledTimes(1);
        });
    });

    describe('input wiring', () => {
        it('calls setValue as the user types', () => {
            render(<PromptBar />);

            fireEvent.change(screen.getByLabelText('Prompt command input'), { target: { value: 'mute track' } });

            expect(module_mocks.set_value).toHaveBeenCalledWith('mute track');
        });

        it('calls handleKeyDown on key presses', () => {
            render(<PromptBar />);

            fireEvent.keyDown(screen.getByLabelText('Prompt command input'), { key: 'ArrowDown' });

            expect(module_mocks.handle_key_down).toHaveBeenCalledTimes(1);
        });

        it('calls setIsFocused(true) synchronously on focus', () => {
            render(<PromptBar />);

            fireEvent.focus(screen.getByLabelText('Prompt command input'));

            expect(module_mocks.set_is_focused).toHaveBeenCalledWith(true);
        });

        it('debounces setIsFocused(false) by 200ms on blur', () => {
            vi.useFakeTimers();
            render(<PromptBar />);

            fireEvent.blur(screen.getByLabelText('Prompt command input'));
            expect(module_mocks.set_is_focused).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(199);
            });
            expect(module_mocks.set_is_focused).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(module_mocks.set_is_focused).toHaveBeenCalledWith(false);
        });

        it('calls handleSubmit when the form is submitted', () => {
            render(<PromptBar />);

            fireEvent.submit(screen.getByLabelText('Prompt command input').closest('form') as HTMLFormElement);

            expect(module_mocks.handle_submit).toHaveBeenCalledTimes(1);
        });
    });

    describe('selection tags', () => {
        it('renders a chip per selection tag and removes it via dismissTag', () => {
            setPromptState({
                selectionTags: [
                    { id: 'track:1', label: 'Kick', kind: 'track', icon: 'track' },
                    { id: 'clips:3', label: '3 clips', kind: 'clips', icon: 'clips' },
                ],
            });

            render(<PromptBar />);

            expect(screen.getByText('Kick')).toBeInTheDocument();
            expect(screen.getByText('3 clips')).toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('Remove Kick from context'));

            expect(module_mocks.dismiss_tag).toHaveBeenCalledWith('track:1');
        });
    });

    describe('fuzzy results dropdown', () => {
        it('renders nothing when there are no fuzzy results', () => {
            render(<PromptBar />);

            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('shows the "Available commands" header when the input is empty', () => {
            setPromptState({
                fuzzyResults: [
                    { preset: { id: 'p1', label: 'Play', category: 'Transport', isDestructive: false }, score: 1 },
                ],
            });

            render(<PromptBar />);

            expect(screen.getByText('Available commands')).toBeInTheDocument();
        });

        it('hides the "Available commands" header once the user has typed something', () => {
            setPromptState({
                value: 'pl',
                fuzzyResults: [
                    { preset: { id: 'p1', label: 'Play', category: 'Transport', isDestructive: false }, score: 1 },
                ],
            });

            render(<PromptBar />);

            expect(screen.queryByText('Available commands')).not.toBeInTheDocument();
            expect(screen.getByRole('option', { name: /Play/ })).toBeInTheDocument();
        });

        it('marks the selected result via aria-selected and executes the preset on mousedown', () => {
            const preset = { id: 'p1', label: 'Play', category: 'Transport' as const, isDestructive: false };
            setPromptState({
                value: 'pl',
                fuzzyResults: [{ preset, score: 1 }],
                selectedIndex: 0,
            });

            render(<PromptBar />);

            const option = screen.getByRole('option', { name: /Play/ });
            expect(option).toHaveAttribute('aria-selected', 'true');

            fireEvent.mouseDown(option);

            expect(module_mocks.execute_preset).toHaveBeenCalledWith({ preset, score: 1 });
        });

        it('shows a destructive-action warning icon for destructive presets', () => {
            setPromptState({
                value: 'clear',
                fuzzyResults: [
                    {
                        preset: { id: 'p2', label: 'Clear all clips', category: 'Clip', isDestructive: true },
                        score: 1,
                    },
                ],
            });

            render(<PromptBar />);

            expect(screen.getByLabelText('Destructive action')).toBeInTheDocument();
        });

        it('shows the "no matching commands" hint when a focused query has zero results', () => {
            setPromptState({
                value: 'zzz',
                isFocused: true,
                fuzzyResults: [],
            });

            render(<PromptBar />);

            expect(screen.getByRole('listbox')).toBeInTheDocument();
            expect(screen.getByText('No matching commands — press Enter to try AI')).toBeInTheDocument();
            expect(screen.getByLabelText('Prompt command input')).toHaveAttribute('aria-expanded', 'true');
        });

        it('closes the empty-results hint when the input is not focused', () => {
            setPromptState({
                value: 'zzz',
                isFocused: false,
                fuzzyResults: [],
            });

            render(<PromptBar />);

            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Prompt command input')).toHaveAttribute('aria-expanded', 'false');
        });

        it('sets aria-expanded and aria-controls on the input to match the dropdown', () => {
            setPromptState({
                fuzzyResults: [
                    { preset: { id: 'p1', label: 'Play', category: 'Transport', isDestructive: false }, score: 1 },
                ],
            });

            render(<PromptBar />);

            const input = screen.getByLabelText('Prompt command input');
            expect(input).toHaveAttribute('aria-expanded', 'true');
            expect(input).toHaveAttribute('aria-controls', 'prompt-results');
            expect(screen.getByRole('listbox', { name: 'Command suggestions' })).toHaveAttribute(
                'id',
                'prompt-results'
            );
        });
    });

    it('calls the AiRuntime use case when the history toggle is clicked', () => {
        render(<PromptBar />);

        fireEvent.click(screen.getByRole('button', { name: 'Toggle AI action history' }));

        expect(vi.mocked(toggleAiHistoryPanel)).toHaveBeenCalledTimes(1);
        expect(module_mocks.toggle_ai_history_panel.mock.calls).toEqual([[]]);
    });

    it('passes the llm status through to LlmStatusBadge', () => {
        setPromptState({ llmStatus: { state: 'loading', progress: 42, text: 'Downloading...' } });

        render(<PromptBar />);

        expect(screen.getByTestId('llm-status-badge')).toHaveAttribute('data-state', 'loading');
    });
});
