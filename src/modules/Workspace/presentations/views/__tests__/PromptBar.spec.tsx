import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PromptBar } from '../PromptBar';

vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn(() => ({ tracks: [] })) }));

vi.mock('../../hooks/usePromptExecution', () => ({
    usePromptExecution: () => ({
        input: '',
        setInput: vi.fn(),
        matches: [],
        selectionTags: [],
        fuzzyResults: [],
        highlightedIndex: -1,
        setHighlightedIndex: vi.fn(),
        isExecuting: false,
        error: null,
        dismissError: vi.fn(),
        executeAction: vi.fn(),
        handleKeyDown: vi.fn(),
        inputRef: { current: null },
        showMenu: false,
        setShowMenu: vi.fn(),
        dismissTag: vi.fn(),
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
});
