import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../../models/GetPendingEffectRecoveryPolicy';
import * as retainedReviewProjection from '../../../useCases/selectRetainedSectionRenderManualReviews';
import { ChatPanel } from '../ChatPanel';

const retainedPreviewMocks = vi.hoisted(() => ({
    cache: vi.fn(),
    play: vi.fn(),
    release: vi.fn(),
    exportWav: vi.fn(),
    getExact: vi.fn(),
    settle: vi.fn(),
    stopVerse: vi.fn(),
    stopChorus: vi.fn(),
}));

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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: retainedPreviewMocks.cache,
    playCachedAudioBufferPreview: retainedPreviewMocks.play,
    releasePreviewAudioBuffer: retainedPreviewMocks.release,
}));

vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    exportExactAgentSectionRenderArtifactAsWav: retainedPreviewMocks.exportWav,
    getExactAgentSectionRenderArtifact: retainedPreviewMocks.getExact,
}));

vi.mock('../../../useCases/settleRetainedSectionRenderManualReview', () => ({
    settleRetainedSectionRenderManualReview: retainedPreviewMocks.settle,
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
const { useStore: useRealStore } =
    await vi.importActual<typeof import('#/infra/store/useStore')>('#/infra/store/useStore');
const { sendChatMessage } = await import('#/modules/AiRuntime/useCases/sendChatMessage');
const { confirmPendingChatActions } = await import('../../../useCases/confirmPendingChatActions');
const { cancelPendingChatActions } = await import('../../../useCases/cancelPendingChatActions');
const { recoverAgentRunPendingEffects } = await import('../../../useCases/recoverAgentRunPendingEffects');
const { agentRunStore } = await import('#/modules/AiRuntime/stores/agentRunStore');
const { capabilityStore, isWebGpuAvailable } = await import('#/modules/BrowserAi/stores');
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
const capabilityReport = {
    capability: 'supported' as const,
    webGpu: { status: 'supported' as const },
    webGpuTier: 'webgpu-fast' as const,
    crossOriginIsolated: true,
    workerAvailable: true,
    opfsAvailable: true,
    inference: {
        status: 'measured' as const,
        modelId: 'kokoro-82m-q8',
        executionProviders: ['webgpu', 'wasm'],
        audioSeconds: 4,
        elapsedSeconds: 2,
        realtimeFactor: 2,
    },
    detectedAt: 0,
};

type RetainedReview = ReturnType<typeof retainedReviewProjection.selectRetainedSectionRenderManualReviews>[number];

const verseBuffer = { numberOfChannels: 2 } as AudioBuffer;
const chorusBuffer = { numberOfChannels: 2 } as AudioBuffer;

function createRetainedReview(input: {
    runId: string;
    batchId: string;
    commandId: string;
    jobId: string;
    sectionName: string;
    buffer: AudioBuffer;
}): RetainedReview {
    const job = {
        jobId: input.jobId,
        sectionId: `section-${input.jobId}`,
        sectionName: input.sectionName,
        startBeat: input.sectionName === 'Verse' ? 0 : 16,
        endBeat: input.sectionName === 'Verse' ? 16 : 32,
        sampleRate: 48_000,
        tailSeconds: 1,
    };
    return {
        binding: {
            runId: input.runId,
            batchId: input.batchId,
            receiptIdentity: `receipt-${input.batchId}`,
            sourceRevision: `revision-${input.batchId}`,
            commands: [{ commandId: input.commandId, jobs: [job] }],
        },
        jobs: [
            {
                commandId: input.commandId,
                job,
                availability: 'available',
                artifact: {
                    owner: 'agent-section-render',
                    retention: 'session',
                    ...job,
                    sourceRevision: `revision-${input.batchId}`,
                    renderedAt: 1,
                    durationSeconds: 1,
                    frameCount: 48_000,
                    channelCount: 2,
                    byteSize: 384_000,
                    warnings: [],
                    buffer: input.buffer,
                },
                warnings: [],
            },
        ],
    };
}

describe('ChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
        capabilityStore.set({ phase: 'idle' });
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store: unknown) => {
            if (store === agentRunStore) {
                return { schemaVersion: 1, runs: [] };
            }
            if (store === capabilityStore) {
                return useRealStore(capabilityStore);
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
        retainedPreviewMocks.cache.mockImplementation(({ buffer }: { buffer: AudioBuffer }) =>
            buffer === verseBuffer ? 'cached-verse' : 'cached-chorus'
        );
        retainedPreviewMocks.play
            .mockReturnValueOnce({ stop: retainedPreviewMocks.stopVerse })
            .mockReturnValue({ stop: retainedPreviewMocks.stopChorus });
        retainedPreviewMocks.exportWav.mockResolvedValue(true);
        retainedPreviewMocks.getExact.mockImplementation(({ job }: { job: { jobId: string } }) => ({
            buffer: job.jobId.includes('verse') ? verseBuffer : chorusBuffer,
        }));
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
        capabilityStore.set({ phase: 'error', message: 'adapter unavailable' });
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

        render(<ChatPanel />);
        expect(screen.getByText('AI Not Available')).toBeInTheDocument();
    });

    it('re-renders from capability checking to available when BrowserAi detection completes', () => {
        capabilityStore.set({ phase: 'detecting' });
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockImplementation(isWebGpuAvailable);
        render(<ChatPanel />);
        expect(screen.getByText('Checking AI availability')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

        act(() => {
            capabilityStore.set({ phase: 'done', report: capabilityReport });
        });

        expect(screen.queryByText('Checking AI availability')).not.toBeInTheDocument();
        expect(screen.queryByText('AI Not Available')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
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

    it('shows persisted pending-effect continuations as manual guidance after chat history is gone', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) =>
            store === agentRunStore
                ? {
                      schemaVersion: 1,
                      runs: [
                          {
                              runId: 'run-retry',
                              revisions: { created: null, planned: null, approved: null, committed: null },
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
                              revisions: { created: null, planned: null, approved: null, committed: null },
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
                              revisions: { created: null, planned: null, approved: null, committed: null },
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
                              revisions: { created: null, planned: null, approved: null, committed: null },
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

        expect(screen.queryByRole('button', { name: 'Retry runtime effect' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Repair audio graph' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reconcile pending effects' })).not.toBeInTheDocument();
        expect(recoverAgentRunPendingEffects).not.toHaveBeenCalled();
        expect(screen.getAllByText('Manual repair required')).toHaveLength(4);
        expect(screen.getAllByText(MISSING_EXACT_CHECKPOINT_RECOVERY_REASON)).toHaveLength(1);
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

    it('renders evicted-run recovery as manual guidance from the non-evictable ledger', () => {
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
        expect(screen.getByText('Manual repair required')).toBeInTheDocument();
        expect(screen.getByText(MISSING_EXACT_CHECKPOINT_RECOVERY_REASON)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Repair audio graph' })).not.toBeInTheDocument();
        expect(recoverAgentRunPendingEffects).not.toHaveBeenCalled();
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

    it('renders the focused retained-review surface while preserving generic manual repair guidance', () => {
        const selectReview = vi.spyOn(retainedReviewProjection, 'selectRetainedSectionRenderManualReviews');
        selectReview.mockReturnValue([
            createRetainedReview({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                commandId: 'command-render-review',
                jobId: 'job-render-review',
                sectionName: 'Chorus',
                buffer: chorusBuffer,
            }),
        ]);
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) =>
            store === agentRunStore
                ? {
                      schemaVersion: 1,
                      runs: [
                          {
                              runId: 'run-render-review',
                              revisions: { created: null, planned: null, approved: null, committed: null },
                              pendingEffectContinuations: [
                                  {
                                      batchId: 'batch-render-review',
                                      effects: [
                                          {
                                              commandId: 'command-render-review',
                                              kind: 'external-effect',
                                              operation: 'renderProjectSections',
                                              reason: 'The retained render must be reviewed.',
                                              remediation: 'manual-repair',
                                              state: 'pending',
                                          },
                                      ],
                                      recovery: 'manual-repair',
                                      lastError: null,
                                  },
                                  {
                                      batchId: 'batch-generic-repair',
                                      effects: [
                                          {
                                              commandId: 'command-publish',
                                              kind: 'external-effect',
                                              operation: 'publishRender',
                                              reason: 'Publication evidence must be inspected manually.',
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
                  }
                : chatState
        );

        render(<ChatPanel />);

        expect(screen.getByText('Retained section render requires review')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Play Chorus' })).toBeInTheDocument();
        expect(
            screen.queryByRole('list', { name: 'Pending effects for batch batch-render-review' })
        ).not.toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Pending effects for batch batch-generic-repair' })).toHaveTextContent(
            'publishRender: Publication evidence must be inspected manually.'
        );
        expect(screen.getByText('Manual repair required')).toBeInTheDocument();
        selectReview.mockRestore();
    });

    it('announces retained-review outcomes and errors when no agent decision exists', async () => {
        const selectReview = vi.spyOn(retainedReviewProjection, 'selectRetainedSectionRenderManualReviews');
        selectReview.mockReturnValue([
            createRetainedReview({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                commandId: 'command-render-review',
                jobId: 'job-render-review',
                sectionName: 'Chorus',
                buffer: chorusBuffer,
            }),
        ]);

        render(<ChatPanel />);

        expect(agentRunControls.listDecisions).toHaveReturnedWith([]);
        expect(screen.queryByText('Agent decision required')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Export Chorus WAV' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Exported the exact retained WAV.');
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');

        retainedPreviewMocks.exportWav.mockRejectedValueOnce(new Error('The exact WAV encoder failed.'));
        fireEvent.click(screen.getByRole('button', { name: 'Export Chorus WAV' }));
        expect(await screen.findByRole('status')).toHaveTextContent('The exact WAV encoder failed.');
        selectReview.mockRestore();
    });

    it('stops and releases the active retained preview before another review card starts', () => {
        const selectReview = vi.spyOn(retainedReviewProjection, 'selectRetainedSectionRenderManualReviews');
        selectReview.mockReturnValue([
            createRetainedReview({
                runId: 'run-shared-review',
                batchId: 'batch-verse-review',
                commandId: 'command-verse-review',
                jobId: 'job-verse-review',
                sectionName: 'Verse',
                buffer: verseBuffer,
            }),
            createRetainedReview({
                runId: 'run-shared-review',
                batchId: 'batch-chorus-review',
                commandId: 'command-chorus-review',
                jobId: 'job-chorus-review',
                sectionName: 'Chorus',
                buffer: chorusBuffer,
            }),
        ]);

        render(<ChatPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        expect(retainedPreviewMocks.stopVerse).toHaveBeenCalledOnce();
        expect(retainedPreviewMocks.release).toHaveBeenNthCalledWith(1, 'cached-verse');
        expect(retainedPreviewMocks.stopVerse.mock.invocationCallOrder[0]).toBeLessThan(
            retainedPreviewMocks.play.mock.invocationCallOrder[1]!
        );
        expect(retainedPreviewMocks.release.mock.invocationCallOrder[0]).toBeLessThan(
            retainedPreviewMocks.play.mock.invocationCallOrder[1]!
        );
        expect(screen.getByRole('button', { name: 'Play Verse' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Stop Chorus' })).toHaveAttribute('aria-pressed', 'true');
        selectReview.mockRestore();
    });

    it('keeps the active preview when another review card has expired', () => {
        const selectReview = vi.spyOn(retainedReviewProjection, 'selectRetainedSectionRenderManualReviews');
        selectReview.mockReturnValue([
            createRetainedReview({
                runId: 'run-shared-review',
                batchId: 'batch-verse-review',
                commandId: 'command-verse-review',
                jobId: 'job-verse-review',
                sectionName: 'Verse',
                buffer: verseBuffer,
            }),
            createRetainedReview({
                runId: 'run-shared-review',
                batchId: 'batch-chorus-review',
                commandId: 'command-chorus-review',
                jobId: 'job-chorus-review',
                sectionName: 'Chorus',
                buffer: chorusBuffer,
            }),
        ]);
        retainedPreviewMocks.getExact.mockImplementation(({ job }: { job: { jobId: string } }) =>
            job.jobId === 'job-verse-review' ? { buffer: verseBuffer } : null
        );

        render(<ChatPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        expect(retainedPreviewMocks.stopVerse).not.toHaveBeenCalled();
        expect(retainedPreviewMocks.release).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Stop Verse' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('Preview audio for Chorus is unavailable.');
        selectReview.mockRestore();
    });

    it('should have correct accessibility attributes', () => {
        render(<ChatPanel />);
        const panel = screen.getByText('AI Chat').closest('[class*="flex-col"]');
        expect(panel).toBeInTheDocument();
    });
});
