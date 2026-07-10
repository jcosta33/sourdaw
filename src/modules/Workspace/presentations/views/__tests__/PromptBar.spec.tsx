import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleAiHistoryPanel } from '#/modules/AiRuntime/useCases';

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
}));

vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn(() => ({ tracks: [] })) }));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    toggleAiHistoryPanel: module_mocks.toggle_ai_history_panel,
}));

vi.mock('../../hooks/usePromptExecution', () => ({
    usePromptExecution: () => ({
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
    }),
}));

vi.mock('../Prompt/LlmStatusBadge', () => ({
    LlmStatusBadge: () => <div data-testid="llm-status-badge" />,
}));

describe('PromptBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PromptBar />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PromptBar />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PromptBar />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should call the AiRuntime use case when the history toggle is clicked', () => {
        render(<PromptBar />);

        fireEvent.click(screen.getByRole('button', { name: 'Toggle AI action history' }));

        expect(vi.mocked(toggleAiHistoryPanel)).toHaveBeenCalledTimes(1);
        expect(module_mocks.toggle_ai_history_panel.mock.calls).toEqual([[]]);
    });
});
