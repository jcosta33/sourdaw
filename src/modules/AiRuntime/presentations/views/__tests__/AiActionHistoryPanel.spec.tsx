import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    executionKind?: 'project' | 'runtime';
};

type MockActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    reverted: boolean;
    groupId?: string;
    groupLabel?: string;
};

const module_mocks = vi.hoisted(() => ({
    use_store: vi.fn<(store: unknown, default_value: unknown) => unknown>(),
    ai_action_history_store: { name: 'aiActionHistoryStore' },
    action_history_store: { name: 'actionHistoryStore' },
    toggle_ai_history_panel: vi.fn<() => void>(),
    clear_ai_history: vi.fn<() => void>(),
    clear_action_history: vi.fn<() => void>(),
    revert_ai_action_group: vi.fn<() => void>(),
    get_action_replay_status: vi.fn<(entry_id: string) => { status: 'ready' | 'reconcile-mark' | 'unavailable' }>(
        () => ({ status: 'ready' })
    ),
    revert_action: vi.fn<
        (entry_id: string) => Promise<{ status: 'executed' | 'executed-unmarked' | 'reconciled' | 'unavailable' }>
    >(async () => ({ status: 'executed' })),
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
}));

vi.mock('#/modules/AiRuntime/useCases/aiHistoryActions', () => ({
    revertAiActionGroup: module_mocks.revert_ai_action_group,
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearActionHistory: module_mocks.clear_action_history,
    getActionReplayStatus: module_mocks.get_action_replay_status,
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
        module_mocks.get_action_replay_status.mockReturnValue({ status: 'ready' });
        module_mocks.revert_action.mockResolvedValue({ status: 'executed' });
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

    it('labels runtime execution receipts without offering Undo', () => {
        mock_ai_state.groups = [
            {
                id: 'g1',
                prompt: 'Play',
                actions: [{ kind: 'appAction', actionType: 'setPlayback', label: 'Start playback' }],
                groupId: 'group-1',
                timestamp: Date.now(),
                reverted: false,
                executionKind: 'runtime',
            },
        ];

        render(<AiActionHistoryPanel />);

        expect(screen.getByText(/1 runtime command/)).toBeInTheDocument();
        expect(screen.getByText('runtime')).toBeInTheDocument();
        expect(screen.queryByTitle('Undo all changes from this AI action')).not.toBeInTheDocument();
    });

    it('should render user actions', () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
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
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];

        render(<AiActionHistoryPanel />);
        fireEvent.click(screen.getByLabelText('Clear action history'));

        expect(module_mocks.clear_ai_history).toHaveBeenCalledTimes(1);
        expect(module_mocks.clear_action_history).toHaveBeenCalledTimes(1);
        expect(module_mocks.clear_action_history.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.clear_ai_history.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should preserve AI display rows and surface failure when authoritative history scrub fails', () => {
        mock_ai_state.groups = [
            {
                id: 'g1',
                prompt: 'Keep this row',
                actions: [{ kind: 'appAction', actionType: 'track.add', label: 'Action 1' }],
                groupId: 'group-1',
                timestamp: Date.now(),
                reverted: false,
            },
        ];
        module_mocks.clear_action_history.mockImplementation(() => {
            throw new Error('target scrub failed');
        });
        render(<AiActionHistoryPanel />);

        fireEvent.click(screen.getByLabelText('Clear action history'));

        expect(module_mocks.clear_ai_history).not.toHaveBeenCalled();
        expect(screen.getByText('Keep this row')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Clear history failed: target scrub failed');
    });

    it('should label mark-only reconciliation as a history retry', () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];
        module_mocks.get_action_replay_status.mockReturnValue({ status: 'reconcile-mark' });

        render(<AiActionHistoryPanel />);

        expect(screen.getByText('History update pending')).toBeInTheDocument();
        expect(screen.getByLabelText('Retry history update')).toBeInTheDocument();
    });

    it('should render the reconciled result without executing the inverse label again', async () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];
        module_mocks.get_action_replay_status.mockReturnValue({ status: 'reconcile-mark' });
        module_mocks.revert_action.mockResolvedValue({ status: 'reconciled' });
        render(<AiActionHistoryPanel />);

        fireEvent.click(screen.getByLabelText('Retry history update'));

        await waitFor(() => expect(screen.getByText('History repaired')).toBeInTheDocument());
        expect(module_mocks.revert_action).toHaveBeenCalledWith('e1');
    });

    it('should surface replay rejection in the action row', async () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'User action',
                actionKind: 'workspace.select',
                timestamp: Date.now(),
                reverted: false,
                source: 'manual',
            },
        ];
        module_mocks.revert_action.mockRejectedValue(new Error('history write failed'));
        render(<AiActionHistoryPanel />);

        fireEvent.click(screen.getByLabelText('Revert this change'));

        await waitFor(() => expect(screen.getByText('Revert failed: history write failed')).toBeInTheDocument());
    });

    it('should warn when the inverse applied after its metadata row was replaced', async () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'Original action',
                actionKind: 'workspace.select',
                timestamp: 10,
                reverted: false,
                source: 'manual',
            },
        ];
        module_mocks.revert_action.mockResolvedValue({ status: 'executed-unmarked' });
        render(<AiActionHistoryPanel />);

        fireEvent.click(screen.getByLabelText('Revert this change'));

        await waitFor(() => expect(screen.getByText('Change applied, but history row changed')).toBeInTheDocument());
        expect(screen.queryByText('Reverted')).not.toBeInTheDocument();
    });

    it('should reset row-local replay status when immutable metadata changes at the same ID', async () => {
        mock_history_state.entries = [
            {
                id: 'e1',
                label: 'Original action',
                actionKind: 'workspace.select',
                timestamp: 10,
                reverted: false,
                source: 'manual',
            },
        ];
        const view = render(<AiActionHistoryPanel />);
        fireEvent.click(screen.getByLabelText('Revert this change'));
        await waitFor(() => expect(screen.getByText('Reverted')).toBeInTheDocument());

        mock_history_state.entries = [{ ...mock_history_state.entries[0]!, label: 'Peer replacement' }];
        view.rerender(<AiActionHistoryPanel />);

        expect(screen.getByText('Peer replacement')).toBeInTheDocument();
        expect(screen.queryByText('Reverted')).not.toBeInTheDocument();
    });
});
