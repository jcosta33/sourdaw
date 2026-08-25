import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatPanel } from '../ChatPanel';

// Mock external dependencies - factories are hoisted, so define mocks inside
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        messages: [],
        isGenerating: false,
        chatMode: 'chat',
        enableReasoning: false,
    })),
}));

vi.mock('#/modules/AiRuntime/stores/chatStore', () => ({
    chatStore: {},
    clearChatMessages: vi.fn(),
    toggleReasoning: vi.fn(),
    setChatMode: vi.fn(),
    stopGenerating: vi.fn(),
}));

vi.mock('../../../stores/agentRunStore', () => ({
    agentRunStore: { kind: 'agent-runs' },
}));

vi.mock('../../../useCases/getAgentRunControlProjection', () => ({
    agentRunControls: {
        list: vi.fn(),
        resumeDecision: vi.fn(),
    },
}));

vi.mock('#/modules/AiRuntime/useCases/sendChatMessage', () => ({
    sendChatMessage: vi.fn(),
}));

vi.mock('../../../useCases/confirmPendingChatActions', () => ({
    confirmPendingChatActions: vi.fn(),
}));

vi.mock('../../../useCases/cancelPendingChatActions', () => ({
    cancelPendingChatActions: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/aiPanelActions/toggleChat', () => ({
    toggleChat: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable', () => ({
    isLlmAvailable: vi.fn(() => true),
}));

vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('remark-gfm', () => ({
    default: vi.fn(),
}));

vi.mock('../../components/ChatComposer', () => ({
    ChatComposer: ({
        executionMode,
        onSend,
        onStop,
        onChange,
        onExecutionModeChange,
        isGenerating,
        isLlmAvailable,
    }: {
        executionMode?: string;
        onSend: () => void;
        onStop: () => void;
        onChange: (value: string) => void;
        onExecutionModeChange?: (mode: string) => void;
        isGenerating: boolean;
        isLlmAvailable: boolean;
    }) => (
        <div data-testid="chat-composer">
            <label>
                Agent execution mode
                <select value={executionMode} onChange={(event) => onExecutionModeChange?.(event.target.value)}>
                    <option value="explain">Explain</option>
                    <option value="plan">Plan</option>
                    <option value="preview">Preview</option>
                    <option value="apply">Apply</option>
                    <option value="macro">Macro</option>
                </select>
            </label>
            <label>
                Chat message input
                <input onChange={(event) => onChange(event.target.value)} />
            </label>
            <button onClick={onSend} disabled={!isLlmAvailable}>
                Send
            </button>
            {isGenerating ? <button onClick={onStop}>Stop</button> : null}
        </div>
    ),
}));

// Import the mocked modules to access mock functions
const { useStore } = await import('#/infra/store/useStore');
const { sendChatMessage } = await import('#/modules/AiRuntime/useCases/sendChatMessage');
const { confirmPendingChatActions } = await import('../../../useCases/confirmPendingChatActions');
const { cancelPendingChatActions } = await import('../../../useCases/cancelPendingChatActions');
const { toggleChat } = await import('#/modules/AiRuntime/useCases/aiPanelActions/toggleChat');
const { isLlmAvailable } =
    await import('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable');
const { agentRunStore } = await import('../../../stores/agentRunStore');
const { agentRunControls } = await import('../../../useCases/getAgentRunControlProjection');

const chatState = {
    messages: [],
    isGenerating: false,
    chatMode: 'chat',
    enableReasoning: false,
};

describe('ChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store: unknown) =>
            store === agentRunStore ? { schemaVersion: 1, runs: [] } : chatState
        );
        (agentRunControls.list as ReturnType<typeof vi.fn>).mockReturnValue([]);
        (agentRunControls.resumeDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 'resumed',
            sourceRunId: 'decision-run',
            runId: 'resumed-run',
            decisionId: 'decision-1',
            selectedAlternativeId: 'keep-tempo',
        });
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it('should render without crashing', () => {
        render(<ChatPanel />);
        expect(screen.getByText('AI Chat')).toBeInTheDocument();
    });

    it('should render with custom style', () => {
        const customStyle = { width: 400 };
        const { container } = render(<ChatPanel style={customStyle} />);
        expect(container.firstChild).toHaveAttribute('style');
    });

    it('should render empty state when no messages', () => {
        render(<ChatPanel />);
        expect(screen.getByText('The kitchen is quiet')).toBeInTheDocument();
        expect(screen.getByText(/Say something to get the dough rising/)).toBeInTheDocument();
    });

    it('should render clear chat button', () => {
        render(<ChatPanel />);
        const clearButton = screen.getByTitle('Clear Chat History');
        expect(clearButton).toBeInTheDocument();
    });

    it('should render close chat button', () => {
        render(<ChatPanel />);
        const closeButton = screen.getByTitle('Close Chat Panel');
        expect(closeButton).toBeInTheDocument();
        fireEvent.click(closeButton);
        expect(toggleChat).toHaveBeenCalled();
    });

    it('should show LLM unavailable warning when not available', () => {
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

        render(<ChatPanel />);
        expect(screen.getByText('Local AI Not Available')).toBeInTheDocument();
    });

    it('should render ChatComposer component', () => {
        render(<ChatPanel />);
        expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    });

    it('routes the selected execution mode into the agent interaction', () => {
        render(<ChatPanel />);

        fireEvent.change(screen.getByLabelText('Agent execution mode'), { target: { value: 'plan' } });
        fireEvent.change(screen.getByLabelText('Chat message input'), {
            target: { value: 'Outline the chorus' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(sendChatMessage).toHaveBeenCalledWith('Outline the chorus', { mode: 'plan' });
    });

    it('should let the user confirm or cancel pending prompt actions', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            messages: [
                {
                    id: 'assistant-1',
                    role: 'assistant',
                    content: 'This prompt requires confirmation',
                    timestamp: 1,
                    isCommandAction: true,
                    pendingActionConfirmationId: 'confirm-1',
                    pendingActionConfirmationStatus: 'proposed',
                },
            ],
            isGenerating: false,
            chatMode: 'prompt',
            enableReasoning: false,
        });

        render(<ChatPanel />);

        expect(screen.getByText('Action')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm pending actions' }));
        expect(confirmPendingChatActions).toHaveBeenCalledWith({ confirmationId: 'confirm-1' });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel pending actions' }));
        expect(cancelPendingChatActions).toHaveBeenCalledWith({ confirmationId: 'confirm-1' });
    });

    it('offers one accessible retry for receipt-bound missing render artifacts', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            messages: [
                {
                    id: 'assistant-1',
                    role: 'assistant',
                    content: 'The project committed, but one section render is missing.',
                    timestamp: 1,
                    isCommandAction: true,
                    pendingActionConfirmationId: 'confirm-1',
                    pendingActionConfirmationStatus: 'executed',
                    pendingActionFollowUpStatus: 'retryable',
                },
            ],
            isGenerating: false,
            chatMode: 'prompt',
            enableReasoning: false,
        });

        render(<ChatPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Retry missing section renders' }));
        expect(confirmPendingChatActions).toHaveBeenCalledWith({ confirmationId: 'confirm-1' });
    });

    it('renders a pending decision in the production chat workspace and resumes only after explicit activation', async () => {
        (agentRunControls.list as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                runId: 'decision-run',
                allowedActions: { resume: true },
                resumeRejectionReason: null,
                decision: {
                    reason: 'Choose the bounded interpretation before the run can continue.',
                    alternatives: [{ id: 'keep-tempo', label: 'Keep the current tempo', changesAuthority: false }],
                },
            },
        ]);

        render(<ChatPanel />);

        expect(screen.getByText('Choose the bounded interpretation before the run can continue.')).toBeInTheDocument();
        const choice = screen.getByRole('button', { name: 'Select Keep the current tempo' });
        expect(choice).toHaveAttribute('type', 'button');
        expect(choice).toHaveFocus();
        expect(agentRunControls.resumeDecision).not.toHaveBeenCalled();

        fireEvent.click(choice);

        expect(agentRunControls.resumeDecision).toHaveBeenCalledWith({
            runId: 'decision-run',
            alternativeId: 'keep-tempo',
        });
        expect(await screen.findByText('Started replacement agent run resumed-run.')).toBeInTheDocument();
    });

    it('replaces the provisional resume status with the public rejection reason', async () => {
        (agentRunControls.list as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                runId: 'decision-run',
                allowedActions: { resume: true },
                resumeRejectionReason: null,
                decision: {
                    reason: 'Choose the bounded interpretation before the run can continue.',
                    alternatives: [{ id: 'keep-tempo', label: 'Keep the current tempo', changesAuthority: false }],
                },
            },
        ]);
        (agentRunControls.resumeDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 'rejected',
            reason: 'The pending decision is unavailable or already consumed.',
        });

        render(<ChatPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Select Keep the current tempo' }));

        expect(await screen.findByText('The pending decision is unavailable or already consumed.')).toBeInTheDocument();
    });

    it('keeps unavailable decisions visible but disabled with their public rejection reason', () => {
        (agentRunControls.list as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                runId: 'stale-run',
                allowedActions: { resume: false },
                resumeRejectionReason: 'The project revision changed while the decision was pending.',
                decision: {
                    reason: 'Choose a tempo before continuing.',
                    alternatives: [{ id: 'keep-tempo', label: 'Keep the current tempo', changesAuthority: false }],
                },
            },
        ]);

        render(<ChatPanel />);

        const choice = screen.getByRole('button', { name: 'Select Keep the current tempo' });
        expect(choice).toBeDisabled();
        expect(choice).toHaveAccessibleDescription(
            /Unavailable: The project revision changed while the decision was pending\./
        );
    });

    it('should have correct accessibility attributes', () => {
        render(<ChatPanel />);
        const panel = screen.getByText('AI Chat').closest('[class*="flex-col"]');
        expect(panel).toBeInTheDocument();
    });
});
