import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiActionHistoryPanel } from '../AiActionHistoryPanel';

type MockAiActionEntry = { kind: 'appAction'; actionType: string; label: string };

type MockAiActionGroup = {
    id: string;
    prompt: string;
    actions: MockAiActionEntry[];
    groupId: string;
    timestamp: number;
    reverted: boolean;
};

type MockActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    action: { type: string; payload?: unknown };
    inverseAction: { type: string; payload?: unknown } | null;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    reverted: boolean;
};

const module_mocks = vi.hoisted(() => ({
    use_store: vi.fn<(store: unknown, default_value: unknown) => unknown>(),
    ai_action_history_store: { name: 'aiActionHistoryStore' },
    action_history_store: { name: 'actionHistoryStore' },
    toggle_ai_history_panel: vi.fn<() => void>(),
    clear_ai_history: vi.fn<() => void>(),
    clear_action_history: vi.fn<() => void>(),
    store_clear_action_history: vi.fn<() => void>(),
    revert_ai_action_group: vi.fn<() => void>(),
    can_revert_action: vi.fn<() => boolean>(() => true),
    revert_action: vi.fn<() => void>(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: module_mocks.use_store,
}));

vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    aiActionHistoryStore: module_mocks.ai_action_history_store,
    toggleAiHistoryPanel: module_mocks.toggle_ai_history_panel,
    clearAiHistory: module_mocks.clear_ai_history,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    actionHistoryStore: module_mocks.action_history_store,
    clearActionHistory: module_mocks.store_clear_action_history,
}));

vi.mock('#/modules/AiRuntime/useCases/aiHistoryActions', () => ({
    revertAiActionGroup: module_mocks.revert_ai_action_group,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    clearActionHistory: module_mocks.clear_action_history,
    canRevertAction: module_mocks.can_revert_action,
    revertAction: module_mocks.revert_action,
}));

const mock_ai_state: { groups: MockAiActionGroup[]; panelOpen: boolean } = {
    groups: [],
    panelOpen: true,
};
const mock_history_state: { entries: MockActionHistoryEntry[] } = { entries: [] };

module_mocks.use_store.mockImplementation((store: unknown, default_value: unknown) => {
    if (store === module_mocks.ai_action_history_store) {
        return mock_ai_state;
    }
    if (store === module_mocks.action_history_store) {
        return mock_history_state;
    }
    return default_value;
});

describe('AiActionHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mock_ai_state.groups = [];
        mock_ai_state.panelOpen = true;
        mock_history_state.entries = [];
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<AiActionHistoryPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should return null when panel is closed', () => {
        mock_ai_state.panelOpen = false;
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
        mock_ai_state.groups = [
            {
                id: 'g1',
                prompt: 'Test prompt',
                actions: [
                    { kind: 'appAction', actionType: 'track.add', label: 'Action 1' },
                    { kind: 'appAction', actionType: 'clip.add', label: 'Action 2' },
                ],
                groupId: 'group-1',
                timestamp: Date.now(),
                reverted: false,
            },
        ];
        render(<AiActionHistoryPanel />);
        expect(screen.getByText('Test prompt')).toBeInTheDocument();
    });

    it('should render user actions', () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
                action: { type: 'workspace.select' },
                inverseAction: null,
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];
        render(<AiActionHistoryPanel />);
        expect(screen.getByText('User action')).toBeInTheDocument();
    });

    it('should call toggleAiHistoryPanel when close button is clicked', () => {
        render(<AiActionHistoryPanel />);
        const closeButton = screen.getByLabelText('Close action history');
        fireEvent.click(closeButton);
        expect(module_mocks.toggle_ai_history_panel).toHaveBeenCalled();
    });

    it('should clear AI and CrdtDocument action history when clear history is clicked', () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
                action: { type: 'workspace.select' },
                inverseAction: null,
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];

        render(<AiActionHistoryPanel />);
        fireEvent.click(screen.getByLabelText('Clear action history'));

        expect(module_mocks.clear_ai_history).toHaveBeenCalledTimes(1);
        expect(module_mocks.clear_action_history).toHaveBeenCalledTimes(1);
        expect(module_mocks.store_clear_action_history).not.toHaveBeenCalled();
    });
});
