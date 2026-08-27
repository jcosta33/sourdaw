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
    chatStore: { kind: 'chat' },
    clearChatMessages: vi.fn(),
    toggleReasoning: vi.fn(),
    setChatMode: vi.fn(),
    stopGenerating: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/stores/agentRunStore', () => ({
    agentRunStore: { kind: 'agent-runs' },
}));

vi.mock('#/modules/BrowserAi/stores', () => ({
    capabilityStore: { kind: 'browser-ai-capability' },
}));

vi.mock('../../../useCases/getAgentRunControlProjection', () => ({
    agentRunControls: {
        listDecisions: vi.fn(),
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

vi.mock('../../../useCases/recoverAgentRunPendingEffects', () => ({
    recoverAgentRunPendingEffects: vi.fn(),
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
const { recoverAgentRunPendingEffects } = await import('../../../useCases/recoverAgentRunPendingEffects');
const { agentRunStore } = await import('#/modules/AiRuntime/stores/agentRunStore');
const { capabilityStore } = await import('#/modules/BrowserAi/stores');
const { toggleChat } = await import('#/modules/AiRuntime/useCases/aiPanelActions/toggleChat');
const { isLlmAvailable } =
    await import('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable');
const { agentRunControls } = await import('../../../useCases/getAgentRunControlProjection');

const chatState = {
    messages: [],
    isGenerating: false,
    chatMode: 'chat',
    enableReasoning: false,
};
let browserAiCapabilityState: { phase: 'idle' | 'detecting' | 'done' | 'error' } = { phase: 'idle' };

describe('ChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
        browserAiCapabilityState = { phase: 'idle' };
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store: unknown) => {
            if (store === agentRunStore) {
                return { schemaVersion: 1, runs: [] };
            }
            if (store === capabilityStore) {
                return browserAiCapabilityState;
            }
            return chatState;
        });
        (agentRunControls.listDecisions as ReturnType<typeof vi.fn>).mockReturnValue([]);
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
        browserAiCapabilityState = { phase: 'error' };
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

        render(<ChatPanel />);
        expect(screen.getByText('AI Not Available')).toBeInTheDocument();
    });

    it('re-renders from capability checking to available when BrowserAi detection completes', () => {
        browserAiCapabilityState = { phase: 'detecting' };
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const { rerender } = render(<ChatPanel />);
        expect(screen.getByText('Checking AI availability')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

        browserAiCapabilityState = { phase: 'done' };
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
        rerender(<ChatPanel key="capability-ready" style={{ width: 401 }} />);

        expect(screen.queryByText('Checking AI availability')).not.toBeInTheDocument();
        expect(screen.queryByText('AI Not Available')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
        expect(useStore).toHaveBeenCalledWith(capabilityStore, { phase: 'idle' });
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
                    pendingActionConfirmationStatus: 'failed',
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
        (agentRunControls.listDecisions as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                runId: 'decision-run',
                allowedActions: { resume: true },
                resumeRejectionReason: null,
                decision: {
                    reason: 'Choose the bounded interpretation before the run can continue.',
                    alternatives: [
                        {
                            id: 'keep tempo / primary!',
                            label: 'Keep the current tempo',
                            changesAuthority: false,
                        },
                    ],
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
            alternativeId: 'keep tempo / primary!',
        });
        expect(await screen.findByText('Started replacement agent run resumed-run.')).toBeInTheDocument();
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(status).toHaveFocus();
    });

    it('replaces the provisional resume status with the public rejection reason', async () => {
        (agentRunControls.listDecisions as ReturnType<typeof vi.fn>).mockReturnValue([
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
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(status).toHaveFocus();
    });

    it('keeps unavailable decisions visible but disabled with their public rejection reason', () => {
        (agentRunControls.listDecisions as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                runId: 'stale-run',
                allowedActions: { resume: false },
                resumeRejectionReason: 'The project revision changed while the decision was pending.',
                decision: {
                    reason: 'Choose a tempo before continuing.',
                    alternatives: [
                        {
                            id: 'keep tempo / primary!',
                            label: 'Keep the current tempo',
                            changesAuthority: false,
                        },
                    ],
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

    it('owns persisted retry, repair, reconciliation, and manual continuations after chat history is gone', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) =>
            store === agentRunStore
                ? {
                      schemaVersion: 1,
                      runs: [
                          {
                              runId: 'run-retry',
                              pendingEffectContinuations: [
                                  {
                                      batchId: 'batch-retry',
                                      effects: [
                                          {
                                              commandId: 'command-retry',
                                              kind: 'runtime-graph',
                                              operation: 'setTrackGain',
                                              reason: 'The gain node rejected the update.',
                                              remediation: 'retry',
                                              state: 'pending',
                                          },
                                      ],
                                      recovery: 'reconcile-batch',
                                      lastError: null,
                                  },
                              ],
                          },
                          {
                              runId: 'run-repair',
                              pendingEffectContinuations: [
                                  {
                                      batchId: 'batch-repair',
                                      effects: [
                                          {
                                              commandId: 'command-repair',
                                              kind: 'runtime-graph',
                                              operation: 'addDevice',
                                              reason: 'The audio graph is stale.',
                                              remediation: 'repair',
                                              state: 'pending',
                                          },
                                      ],
                                      recovery: 'reconcile-batch',
                                      lastError: 'The graph needs reconciliation.',
                                  },
                              ],
                          },
                          {
                              runId: 'run-reconcile',
                              pendingEffectContinuations: [
                                  {
                                      batchId: 'batch-reconcile',
                                      effects: [
                                          {
                                              commandId: 'command-reconcile',
                                              kind: 'external-effect',
                                              operation: 'renderProjectSections',
                                              reason: 'The publication queue is unavailable.',
                                              remediation: 'reconcile',
                                              state: 'pending',
                                          },
                                      ],
                                      recovery: 'reconcile-batch',
                                      lastError: null,
                                  },
                              ],
                          },
                          {
                              runId: 'run-manual',
                              pendingEffectContinuations: [
                                  {
                                      batchId: 'batch-manual',
                                      effects: [
                                          {
                                              commandId: 'command-manual',
                                              kind: 'external-effect',
                                              operation: 'publishRender',
                                              reason: 'The external system cannot prove an exact retry.',
                                              remediation: 'manual-repair',
                                              state: 'pending',
                                          },
                                      ],
                                      recovery: 'manual-repair',
                                      lastError: null,
                                  },
                              ],
                          },
                      ],
                      pendingEffectRecoveryLedger: [
                          {
                              runId: 'run-repair',
                              batchId: 'batch-repair',
                              checkpoint: 'durable',
                              effects: [
                                  {
                                      commandId: 'command-repair',
                                      kind: 'runtime-graph',
                                      operation: 'addDevice',
                                      reason: 'The durable recovery ledger owns this repair.',
                                      remediation: 'repair',
                                      state: 'pending',
                                  },
                              ],
                              recovery: 'reconcile-batch',
                              lastError: 'The durable graph repair is ready.',
                          },
                      ],
                  }
                : {
                      messages: [],
                      isGenerating: false,
                      chatMode: 'chat',
                      enableReasoning: false,
                  }
        );

        render(<ChatPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Retry runtime effect' }));
        fireEvent.click(screen.getByRole('button', { name: 'Repair audio graph' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reconcile pending effects' }));
        expect(recoverAgentRunPendingEffects).toHaveBeenNthCalledWith(1, {
            runId: 'run-retry',
            batchId: 'batch-retry',
        });
        expect(recoverAgentRunPendingEffects).toHaveBeenNthCalledWith(2, {
            runId: 'run-repair',
            batchId: 'batch-repair',
        });
        expect(recoverAgentRunPendingEffects).toHaveBeenNthCalledWith(3, {
            runId: 'run-reconcile',
            batchId: 'batch-reconcile',
        });
        expect(recoverAgentRunPendingEffects).toHaveBeenCalledTimes(3);
        expect(screen.getByText('Manual repair required')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Pending effects for batch batch-manual' })).toHaveTextContent(
            'publishRender: The external system cannot prove an exact retry.'
        );
        expect(screen.getByRole('list', { name: 'Pending effects for batch batch-reconcile' })).toHaveTextContent(
            'renderProjectSections: The publication queue is unavailable.'
        );
        expect(screen.getAllByRole('list', { name: 'Pending effects for batch batch-repair' })).toHaveLength(1);
        expect(screen.getByRole('list', { name: 'Pending effects for batch batch-repair' })).toHaveTextContent(
            'addDevice: The durable recovery ledger owns this repair.'
        );
        expect(screen.getByText('The durable graph repair is ready.')).toBeInTheDocument();
    });

    it('renders recovery owned by an evicted run from the non-evictable ledger', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) =>
            store === agentRunStore
                ? {
                      schemaVersion: 1,
                      runs: [],
                      pendingEffectRecoveryLedger: [
                          {
                              runId: 'run-evicted',
                              batchId: 'batch-evicted',
                              checkpoint: 'durable',
                              effects: [
                                  {
                                      commandId: 'command-evicted',
                                      kind: 'runtime-graph',
                                      operation: 'loadExternalPlugin',
                                      reason: 'The native plugin host needs a graph rebuild.',
                                      remediation: 'repair',
                                      state: 'pending',
                                  },
                              ],
                              recovery: 'reconcile-batch',
                              lastError: null,
                          },
                      ],
                  }
                : {
                      messages: [],
                      isGenerating: false,
                      chatMode: 'chat',
                      enableReasoning: false,
                  }
        );

        render(<ChatPanel />);

        expect(screen.queryByText('The kitchen is quiet')).not.toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Pending effects for batch batch-evicted' })).toHaveTextContent(
            'loadExternalPlugin: The native plugin host needs a graph rebuild.'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Repair audio graph' }));
        expect(recoverAgentRunPendingEffects).toHaveBeenCalledWith({
            runId: 'run-evicted',
            batchId: 'batch-evicted',
        });
    });

    it('surfaces retained prepared media when an evicted run requires manual repair', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) =>
            store === agentRunStore
                ? {
                      schemaVersion: 1,
                      runs: [],
                      preparedStemImportRecoveryLedger: [
                          {
                              schemaVersion: 1,
                              runId: 'run-evicted-stems',
                              batchId: 'batch-evicted-stems',
                              serializedCommandBatch: 'invalid retained batch',
                              resources: [
                                  {
                                      audioBufferId: 'buffer-evicted-stems',
                                      assetLeaseId: 'lease-evicted-stems',
                                  },
                              ],
                              status: 'manual-repair',
                              lastError: 'The retained command proof is invalid. Keep the staged media for inspection.',
                              manualRepairRequiredAt: 500,
                          },
                      ],
                  }
                : {
                      messages: [],
                      isGenerating: false,
                      chatMode: 'chat',
                      enableReasoning: false,
                  }
        );

        render(<ChatPanel />);

        expect(screen.queryByText('The kitchen is quiet')).not.toBeInTheDocument();
        expect(screen.getByText('Prepared stem import requires manual repair')).toBeInTheDocument();
        expect(screen.getByText('Retained media: buffer-evicted-stems')).toBeInTheDocument();
        expect(screen.getByText(/retained command proof is invalid/i)).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        render(<ChatPanel />);
        const panel = screen.getByText('AI Chat').closest('[class*="flex-col"]');
        expect(panel).toBeInTheDocument();
    });
});
