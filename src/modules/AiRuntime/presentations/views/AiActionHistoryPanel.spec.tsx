import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiActionHistoryPanel } from './AiActionHistoryPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    aiActionHistoryStore: {},
    toggleAiHistoryPanel: vi.fn(),
    clearAiHistory: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/stores/actionHistoryStore', () => ({
    actionHistoryStore: {},
    clearActionHistory: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/aiHistoryActions', () => ({
    revertAiActionGroup: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases/revertAction', () => ({
    revertAction: vi.fn(),
    canRevertAction: vi.fn(() => true),
}));

// Mock the store modules to return test data
let mockAiState = { groups: [], panelOpen: false };
let mockHistoryState = { entries: [] };

vi.mocked(vi.importMock('#/infra/store/useStore').useStore).mockImplementation((store) => {
    if (store === vi.importMock('#/modules/AiRuntime/stores/aiActionHistoryStore').aiActionHistoryStore) {
        return mockAiState;
    }
    if (store === vi.importMock('#/modules/CrdtDocument/stores/actionHistoryStore').actionHistoryStore) {
        return mockHistoryState;
    }
    return {};
});

describe('AiActionHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAiState = { groups: [], panelOpen: true };
        mockHistoryState = { entries: [] };
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<AiActionHistoryPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should return null when panel is closed', () => {
        mockAiState = { groups: [], panelOpen: false };
        const { container } = render(<AiActionHistoryPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render "Action History" title', () => {
        render(<AiActionHistoryPanel />);
        expect(screen.getByText('Action History')).toBeInTheDocument();
    });

    it('should render empty state when no actions', () => {
        render(<AiActionHistoryPanel />);
        expect(screen.getByText('No actions yet')).toBeInTheDocument();
        expect(screen.getByText('Changes you make will appear here.')).toBeInTheDocument();
    });

    it('should render AI action groups', () => {
        mockAiState = {
            panelOpen: true,
            groups: [
                {
                    id: 'g1',
                    prompt: 'Test prompt',
                    actions: [{ label: 'Action 1' }, { label: 'Action 2' }],
                    timestamp: Date.now(),
                    reverted: false,
                },
            ],
        };
        const { rerender } = render(<AiActionHistoryPanel />);
        // Force re-render with new mock data
        expect(screen.getByText('Test prompt')).toBeInTheDocument();
    });

    it('should render user actions', () => {
        mockHistoryState = {
            entries: [
                {
                    id: 'e1',
                    label: 'User action',
                    timestamp: Date.now(),
                    reverted: false,
                    source: 'user',
                },
            ],
        };
        render(<AiActionHistoryPanel />);
        expect(screen.getByText('User action')).toBeInTheDocument();
    });

    it('should call toggleAiHistoryPanel when close button is clicked', () => {
        const { toggleAiHistoryPanel } = vi.importMock('#/modules/AiRuntime/stores/aiActionHistoryStore');
        render(<AiActionHistoryPanel />);
        const closeButton = screen.getByLabelText('Close action history');
        fireEvent.click(closeButton);
        expect(toggleAiHistoryPanel).toHaveBeenCalled();
    });
});
