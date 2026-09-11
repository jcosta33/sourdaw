import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { agentRunStore, aiActionHistoryStore, pendingActionConfirmationStore } from '#/modules/AiRuntime/stores';

import { AgentWorkspace } from '../AgentWorkspace';

type AgentRun = NonNullable<typeof agentRunStore.value>['runs'][number];
type AiActionGroup = NonNullable<typeof aiActionHistoryStore.value>['groups'][number];
type PendingConfirmation = NonNullable<typeof pendingActionConfirmationStore.value>['confirmations'][number];

const agentRunControlsMock = vi.hoisted(() => ({
    get: vi.fn(),
    list: vi.fn(),
    listDecisions: vi.fn(() => []),
    resumeDecision: vi.fn(),
}));
const getProviderRouteViewMock = vi.hoisted(() => vi.fn());
const confirmPendingChatActionsMock = vi.hoisted(() => vi.fn());
const cancelPendingChatActionsMock = vi.hoisted(() => vi.fn());
const agentRunCancellationMock = vi.hoisted(() => ({ cancel: vi.fn() }));
const revertAiActionGroupMock = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AiRuntime/useCases', () => ({
    agentRunControls: agentRunControlsMock,
    agentRunCancellation: agentRunCancellationMock,
    getProviderRouteView: getProviderRouteViewMock,
    confirmPendingChatActions: confirmPendingChatActionsMock,
    cancelPendingChatActions: cancelPendingChatActionsMock,
    revertAiActionGroup: revertAiActionGroupMock,
}));

// Real `createStore` instances so `useStore` subscribes for real: the focus
// restoration and disappearing-run cases depend on an actual store notification
// driving the re-render, not on a re-render the test performs itself.
vi.mock('#/modules/AiRuntime/stores', async () => {
    const { createStore } =
        await vi.importActual<typeof import('#/infra/store/createStore')>('#/infra/store/createStore');
    return {
        agentRunStore: createStore({ initialData: { schemaVersion: 1, runs: [] } }),
        aiActionHistoryStore: createStore({ initialData: { groups: [], panelOpen: false } }),
        pendingActionConfirmationStore: createStore({ initialData: { confirmations: [] } }),
    };
});

vi.mock('#/modules/AiRuntime/presentations/views', () => ({
    AgentRunDecisionPanel: () => <div data-testid="agent-decision-panel" />,
}));

type ProjectionOverrides = {
    runId?: string;
    phase?: string;
    request?: string;
    cancellation?: { requested: boolean; acknowledgement: string };
    allowedActions?: { cancel: boolean; resume: boolean; retryWorkIds: string[] };
    manualResumeReason?: string | null;
    committedReceipts?: Array<{ workId: string; receiptIdentity: string; revertGroupId: string | null }>;
};

const projection = (overrides: ProjectionOverrides = {}) => ({
    runId: 'run-1',
    schemaVersion: 1 as const,
    mode: 'apply',
    phase: 'running',
    request: 'Add a bassline',
    cancellation: { requested: false, acknowledgement: 'none' },
    allowedActions: { cancel: true, resume: false, retryWorkIds: [] as string[] },
    manualResumeReason: null,
    resumeRejectionReason: null,
    decision: null,
    committedReceipts: [] as Array<{ workId: string; receiptIdentity: string; revertGroupId: string | null }>,
    errors: [],
    ...overrides,
});

const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    schemaVersion: 1,
    runId: 'run-1',
    request: 'Add a bassline',
    mode: 'apply',
    phase: 'executing',
    revisions: { created: null, planned: null, approved: null, committed: null },
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    grants: {
        allowedOperationPrefixes: [],
        create: false,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    },
    budgets: { limits: {}, consumed: {} },
    budgetAttempts: [],
    plan: null,
    decision: null,
    resume: null,
    batches: [],
    receipts: [],
    renders: [],
    analyses: [],
    modelRoute: { requestedRoute: 'auto', selectedRouteId: null },
    providerUsage: [],
    errors: [],
    saga: { schemaVersion: 1, steps: [] },
    cancellation: {
        generation: 0,
        requestedAt: null,
        reason: null,
        consumerAcknowledgedAt: null,
        transportAcknowledgedAt: null,
        backendAcknowledgedAt: null,
    },
    committedWork: [],
    retriableWork: [],
    temporaryAssets: [],
    pendingEffectContinuations: [],
    preparedStemImports: [],
    manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
    workLeases: [],
    contextEvidence: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

const confirmation = (overrides: Partial<PendingConfirmation> = {}): PendingConfirmation => ({
    kind: 'app_actions',
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Add a bassline',
    assistantMessageId: 'message-1',
    actionLabels: ['Create track Bass'],
    affectedIds: ['track-9'],
    protectedUnchanged: [{ id: 'track-1', name: 'Protected drums' }],
    risk: { level: 'bounded-reversible', reason: 'Adds one track' },
    executedActions: [],
    status: 'proposed',
    error: null,
    followUpProjectRevision: null,
    followUpStatus: null,
    supersedes: null,
    supersededBy: null,
    createdAt: 10,
    resolvedAt: null,
    projectRevision: 'revision-7',
    actions: [],
    approvalSnapshot: {
        actions: [],
        actionLabels: ['Create track Bass'],
        protectedUnchanged: [{ id: 'track-1', name: 'Protected drums' }],
    },
    executionMode: undefined,
    ...overrides,
});

const historyGroup = (overrides: Partial<AiActionGroup> = {}): AiActionGroup => ({
    id: 'group-1',
    prompt: 'Add a bassline',
    actions: [{ kind: 'appAction', actionType: 'createTrack', label: 'Create track Bass' }],
    groupId: 'g1',
    timestamp: 100,
    reverted: false,
    executionKind: 'project',
    ...overrides,
});

const routeView = () => ({
    runId: 'run-1',
    requested: { route: 'cloud', locality: 'remote' },
    actual: { routeId: 'cloud', executor: 'cloud', locality: 'remote', provider: 'anthropic', model: 'sonnet' },
    platform: { available: false, evidence: null, unavailableReason: 'no-webgpu' },
    capability: null,
    fidelity: null,
    fallback: { attempted: false, reasons: [] },
    dataDisclosure: null,
    usage: { provenance: 'provider-reported', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, attempts: 1 },
    cost: [],
});

function setRuns(runs: AgentRun[]): void {
    agentRunStore.set({ schemaVersion: 1, runs });
}

beforeEach(() => {
    vi.clearAllMocks();
    agentRunControlsMock.listDecisions.mockReturnValue([]);
    agentRunControlsMock.list.mockReturnValue([]);
    agentRunControlsMock.get.mockReturnValue(null);
    getProviderRouteViewMock.mockReturnValue(null);
    setRuns([]);
    aiActionHistoryStore.set({ groups: [], panelOpen: false });
    pendingActionConfirmationStore.set({ confirmations: [] });
});

describe('AgentWorkspace', () => {
    it('renders an empty state when no agent runs exist', () => {
        render(<AgentWorkspace />);

        expect(screen.getByText('No agent runs yet')).toBeInTheDocument();
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('lists runs newest first and selects the newest by default', () => {
        agentRunControlsMock.list.mockReturnValue([
            projection({ runId: 'run-2', request: 'Newest request' }),
            projection({ runId: 'run-1', request: 'Older request' }),
        ]);
        setRuns([
            run({ runId: 'run-2', request: 'Newest request' }),
            run({ runId: 'run-1', request: 'Older request' }),
        ]);

        render(<AgentWorkspace />);

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        expect(options[1]).toHaveAttribute('aria-selected', 'false');
        const summary = within(screen.getByRole('region', { name: 'Run summary' }));
        expect(summary.getByText('Newest request')).toBeInTheDocument();
    });

    it('moves selection with ArrowDown while focus stays on the listbox', () => {
        agentRunControlsMock.list.mockReturnValue([
            projection({ runId: 'run-3', request: 'Newest request' }),
            projection({ runId: 'run-2', request: 'Middle request' }),
            projection({ runId: 'run-1', request: 'Older request' }),
        ]);
        setRuns([
            run({ runId: 'run-3', request: 'Newest request' }),
            run({ runId: 'run-2', request: 'Middle request' }),
            run({ runId: 'run-1', request: 'Older request' }),
        ]);

        render(<AgentWorkspace />);
        const listbox = screen.getByRole('listbox');
        listbox.focus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });

        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveAttribute('aria-selected', 'true');
        expect(listbox).toHaveAttribute('aria-activedescendant', options[2]!.id);
        expect(document.activeElement).toBe(listbox);
    });

    it('activates a run with Enter and moves focus to the summary heading', () => {
        agentRunControlsMock.list.mockReturnValue([
            projection({ runId: 'run-2', request: 'Newest request' }),
            projection({ runId: 'run-1', request: 'Older request' }),
        ]);
        setRuns([
            run({ runId: 'run-2', request: 'Newest request' }),
            run({ runId: 'run-1', request: 'Older request' }),
        ]);

        render(<AgentWorkspace />);
        const listbox = screen.getByRole('listbox');
        listbox.focus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' });

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Run summary' }));
        const summary = within(screen.getByRole('region', { name: 'Run summary' }));
        expect(summary.getByText('Older request')).toBeInTheDocument();
    });

    it('activates a run with a click and moves focus to the summary heading', () => {
        agentRunControlsMock.list.mockReturnValue([
            projection({ runId: 'run-2', request: 'Newest request' }),
            projection({ runId: 'run-1', request: 'Older request' }),
        ]);
        setRuns([
            run({ runId: 'run-2', request: 'Newest request' }),
            run({ runId: 'run-1', request: 'Older request' }),
        ]);

        render(<AgentWorkspace />);
        fireEvent.click(screen.getAllByRole('option')[1]!);

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Run summary' }));
        const summary = within(screen.getByRole('region', { name: 'Run summary' }));
        expect(summary.getByText('Older request')).toBeInTheDocument();
    });

    it("shows only the selected run's pending approvals", () => {
        agentRunControlsMock.list.mockReturnValue([
            projection({ runId: 'run-2', request: 'Newest request' }),
            projection({ runId: 'run-1', request: 'Older request' }),
        ]);
        setRuns([
            run({ runId: 'run-2', request: 'Newest request' }),
            run({ runId: 'run-1', request: 'Older request' }),
        ]);
        pendingActionConfirmationStore.set({
            confirmations: [
                confirmation({ id: 'confirmation-2', runId: 'run-2', actionLabels: ['Create track Drums'] }),
                confirmation({ id: 'confirmation-1', runId: 'run-1', actionLabels: ['Create track Bass'] }),
            ],
        });

        render(<AgentWorkspace />);

        expect(screen.getByText('Create track Drums')).toBeInTheDocument();
        expect(screen.queryByText('Create track Bass')).not.toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('option')[1]!);

        expect(screen.getByText('Create track Bass')).toBeInTheDocument();
        expect(screen.queryByText('Create track Drums')).not.toBeInTheDocument();
    });

    it("reverts the receipt's own history group when several exist", () => {
        const receipts = [{ workId: 'work-1', receiptIdentity: 'receipt-1', revertGroupId: 'g2' }];
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection({ committedReceipts: receipts }));
        setRuns([run()]);
        const newestGroup = historyGroup({ id: 'group-1', groupId: 'g1', timestamp: 200 });
        const receiptGroup = historyGroup({ id: 'group-2', groupId: 'g2', timestamp: 100 });
        aiActionHistoryStore.set({ groups: [newestGroup, receiptGroup], panelOpen: false });

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Revert receipt work-1' }));

        expect(revertAiActionGroupMock).toHaveBeenCalledExactlyOnceWith(receiptGroup);
        expect(revertAiActionGroupMock).not.toHaveBeenCalledWith(newestGroup);
    });

    it('keeps the polite phase region mounted before a run exists and announces terminal outcomes as a sibling alert', () => {
        const { rerender } = render(<AgentWorkspace />);

        expect(screen.getByRole('status')).toBeInTheDocument();

        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection({ phase: 'completed' }));
        act(() => {
            setRuns([run()]);
        });
        rerender(<AgentWorkspace />);

        const status = screen.getByRole('status');
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(status).not.toContainElement(alert);
    });

    it('renders scope, protections and granted flags for the selected run', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([
            run({
                scope: {
                    targetIds: ['track-target'],
                    targetRanges: [{ startBeat: 0, endBeat: 8 }],
                    protectedTargetIds: ['track-protected'],
                    protectedRanges: [{ startBeat: 16, endBeat: 24 }],
                },
                grants: {
                    allowedOperationPrefixes: [],
                    create: true,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
            }),
        ]);

        render(<AgentWorkspace />);

        expect(screen.getByText('track-target')).toBeInTheDocument();
        expect(screen.getByText('track-protected')).toBeInTheDocument();
        expect(screen.getByText('0–8 beats')).toBeInTheDocument();
        expect(screen.getByText('create')).toBeInTheDocument();
        expect(screen.queryByText('delete')).not.toBeInTheDocument();
    });

    it('renders the interpreted plan without any reasoning field', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        const planned = {
            ...run({
                plan: {
                    summary: 'Bassline',
                    commandIds: [],
                    serializedBatchIdentity: null,
                    revision: null,
                    classification: 'simple',
                    showPlanPanel: true,
                    objective: 'Write a walking bassline',
                    interpretedConstraints: ['Stay in the key'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    steps: [{ order: 1, actionType: 'addNotes', description: 'Add eight notes' }],
                    expectedImpact: {
                        project: ['One clip gains notes'],
                        audible: { status: 'not-claimed', reason: 'No render' },
                    },
                    capabilities: [],
                    risks: ['Could clash with the melody'],
                    approvalPoints: [{ kind: 'command-confirmation', reason: 'Creates a clip' }],
                    validationStrategy: [],
                    stoppingConditions: [],
                    alternatives: [{ id: 'alt-1', label: 'Use a root-note bassline', changesAuthority: false }],
                    needsUserDecision: false,
                },
            }),
            reasoning: 'secret',
        };
        setRuns([planned]);

        const { container } = render(<AgentWorkspace />);

        expect(screen.getByText('Write a walking bassline')).toBeInTheDocument();
        expect(screen.getByText('addNotes: Add eight notes')).toBeInTheDocument();
        expect(container.textContent).not.toContain('secret');
    });

    it('announces phase in a polite live region and a terminal outcome in an alert', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection({ phase: 'running' }));
        setRuns([run()]);

        const { rerender } = render(<AgentWorkspace />);

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Phase: running');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        agentRunControlsMock.get.mockReturnValue(
            projection({ phase: 'failed', allowedActions: { cancel: false, resume: false, retryWorkIds: [] } })
        );
        rerender(<AgentWorkspace />);

        expect(screen.getByRole('alert')).toHaveTextContent('Run failed');
    });

    it('renders the provider route view fields', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        getProviderRouteViewMock.mockReturnValue(routeView());

        const { rerender } = render(<AgentWorkspace />);

        expect(screen.getByText('cloud (remote)')).toBeInTheDocument();
        expect(screen.getByText('cloud / anthropic / sonnet (remote)')).toBeInTheDocument();
        expect(screen.getByText('unavailable: no-webgpu')).toBeInTheDocument();
        expect(screen.getByText('provider-reported over 1 attempts')).toBeInTheDocument();

        getProviderRouteViewMock.mockReturnValue(null);
        rerender(<AgentWorkspace />);

        expect(screen.getByText('Route not resolved')).toBeInTheDocument();
    });

    it('confirms and cancels a proposed approval through the AiRuntime use cases', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Confirm agent actions' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel agent actions' }));

        expect(confirmPendingChatActionsMock).toHaveBeenCalledExactlyOnceWith({ confirmationId: 'confirmation-1' });
        expect(cancelPendingChatActionsMock).toHaveBeenCalledExactlyOnceWith({ confirmationId: 'confirmation-1' });

        act(() => {
            pendingActionConfirmationStore.set({ confirmations: [confirmation({ status: 'executed' })] });
        });

        expect(screen.queryByRole('button', { name: 'Confirm agent actions' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel agent actions' })).not.toBeInTheDocument();
    });

    it('cancels the run only when the projection allows it', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(
            projection({ allowedActions: { cancel: false, resume: false, retryWorkIds: [] } })
        );
        setRuns([run()]);

        const { rerender } = render(<AgentWorkspace />);

        const disabledCancel = screen.getByRole('button', { name: 'Cancel agent run' });
        expect(disabledCancel).toBeDisabled();
        fireEvent.click(disabledCancel);
        expect(agentRunCancellationMock.cancel).not.toHaveBeenCalled();

        agentRunControlsMock.get.mockReturnValue(projection());
        rerender(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel agent run' }));
        expect(agentRunCancellationMock.cancel).toHaveBeenCalledExactlyOnceWith({
            runId: 'run-1',
            reason: 'user-requested',
        });
    });

    it('reverts a committed receipt through its history group', () => {
        const receipts = [{ workId: 'work-1', receiptIdentity: 'receipt-1', revertGroupId: 'g1' }];
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection({ committedReceipts: receipts }));
        setRuns([run()]);
        const group = historyGroup();
        aiActionHistoryStore.set({ groups: [group], panelOpen: false });

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Revert receipt work-1' }));
        expect(revertAiActionGroupMock).toHaveBeenCalledExactlyOnceWith(group);

        act(() => {
            aiActionHistoryStore.set({ groups: [], panelOpen: false });
        });

        const unavailable = screen.getByRole('button', { name: 'Revert receipt work-1' });
        expect(unavailable).toBeDisabled();
        expect(unavailable).toHaveTextContent('Revert unavailable');
    });

    it('reverts a history group and disables reverted or runtime groups', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        const fresh = historyGroup({ id: 'group-fresh', prompt: 'Fresh change', groupId: 'g-fresh', timestamp: 300 });
        aiActionHistoryStore.set({
            groups: [
                fresh,
                historyGroup({
                    id: 'group-reverted',
                    prompt: 'Reverted change',
                    groupId: 'g-r',
                    timestamp: 200,
                    reverted: true,
                }),
                historyGroup({
                    id: 'group-runtime',
                    prompt: 'Runtime change',
                    groupId: 'g-rt',
                    timestamp: 100,
                    executionKind: 'runtime',
                }),
            ],
            panelOpen: false,
        });

        render(<AgentWorkspace />);

        const freshButton = screen.getByRole('button', { name: 'Revert agent changes Fresh change' });
        expect(freshButton).toBeEnabled();
        fireEvent.click(freshButton);
        expect(revertAiActionGroupMock).toHaveBeenCalledExactlyOnceWith(fresh);

        expect(screen.getByRole('button', { name: 'Revert agent changes Reverted change' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Revert agent changes Runtime change' })).toBeDisabled();
    });

    it('returns focus to the run list when the selected run disappears', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);

        render(<AgentWorkspace />);
        fireEvent.click(screen.getByRole('option'));
        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Run summary' }));

        agentRunControlsMock.list.mockReturnValue([]);
        act(() => {
            setRuns([]);
        });

        const listbox = screen.getByRole('listbox');
        expect(listbox).toBeInTheDocument();
        expect(listbox).toHaveTextContent('No agent runs yet');
        expect(document.activeElement).toBe(listbox);
    });

    it('every interactive control has an accessible name', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(
            projection({ committedReceipts: [{ workId: 'work-1', receiptIdentity: 'receipt-1', revertGroupId: 'g1' }] })
        );
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        aiActionHistoryStore.set({ groups: [historyGroup()], panelOpen: false });

        const { container } = render(<AgentWorkspace />);

        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            expect(button).toHaveAccessibleName();
        }

        const transitioning = container.querySelectorAll('[class*="transition-"]');
        expect(transitioning.length).toBeGreaterThan(0);
        for (const element of transitioning) {
            expect(element.className).toContain('motion-reduce:transition-none');
        }
    });
});
