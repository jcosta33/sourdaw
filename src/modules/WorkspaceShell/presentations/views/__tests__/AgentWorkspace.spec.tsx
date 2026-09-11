import { type ComponentProps } from 'react';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    agentChangeComparisonStore,
    agentRunStore,
    aiActionHistoryStore,
    pendingActionConfirmationStore,
} from '#/modules/AiRuntime/stores';

import { type AgentApprovalSection } from '../../components/agentWorkspace/AgentApprovalSection';
import { AgentWorkspace } from '../AgentWorkspace';

type AgentRun = NonNullable<typeof agentRunStore.value>['runs'][number];
type AiActionGroup = NonNullable<typeof aiActionHistoryStore.value>['groups'][number];
type PendingConfirmation = NonNullable<typeof pendingActionConfirmationStore.value>['confirmations'][number];
type ApprovalView = ComponentProps<typeof AgentApprovalSection>['approvals'][number];
type ApprovalIntentGroup = ApprovalView['intentGroups'][number];

const agentRunControlsMock = vi.hoisted(() => ({
    get: vi.fn(),
    list: vi.fn(),
    listDecisions: vi.fn(() => []),
    resumeDecision: vi.fn(),
}));
const getProviderRouteViewMock = vi.hoisted(() => vi.fn());
const getAgentApprovalViewMock = vi.hoisted(() => vi.fn());
const confirmPendingChatActionsMock = vi.hoisted(() => vi.fn());
const cancelPendingChatActionsMock = vi.hoisted(() => vi.fn());
const reproposePendingChatActionsMock = vi.hoisted(() => vi.fn());
const agentRunCancellationMock = vi.hoisted(() => ({ cancel: vi.fn() }));
const revertAiActionGroupMock = vi.hoisted(() => vi.fn());
const agentChangeComparisonMock = vi.hoisted(() => ({
    availability: vi.fn(),
    start: vi.fn(),
    toggle: vi.fn(),
    end: vi.fn(),
}));
const getAgentChangeComparisonViewMock = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AiRuntime/useCases', () => ({
    agentRunControls: agentRunControlsMock,
    agentRunCancellation: agentRunCancellationMock,
    getProviderRouteView: getProviderRouteViewMock,
    getAgentApprovalView: getAgentApprovalViewMock,
    confirmPendingChatActions: confirmPendingChatActionsMock,
    cancelPendingChatActions: cancelPendingChatActionsMock,
    reproposePendingChatActions: reproposePendingChatActionsMock,
    revertAiActionGroup: revertAiActionGroupMock,
    agentChangeComparison: agentChangeComparisonMock,
    getAgentChangeComparisonView: getAgentChangeComparisonViewMock,
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
        agentChangeComparisonStore: createStore({ initialData: { active: null, lastEnded: null } }),
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
    options: [
        { routeId: 'webllm', admitted: false, reasons: ['platform-unavailable', 'model-not-installed'] },
        { routeId: 'cloud', admitted: true, reasons: [] },
    ],
    capability: null,
    fidelity: null,
    fallback: { attempted: false, reasons: [] },
    fallbackPolicy: 'hosted-then-local',
    dataDisclosure: null,
    usage: { provenance: 'provider-reported', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, attempts: 1 },
    cost: [],
});

const intentGroup = (overrides: Partial<ApprovalIntentGroup> = {}): ApprovalIntentGroup => ({
    id: 'group-a',
    summary: 'Create the bass track',
    affectedTrackIds: [],
    estimatedAudioImpact: { level: 'structural', summary: 'Changes the arrangement' },
    warnings: [],
    dependsOnGroupIds: [],
    ...overrides,
});

const approvalView = (overrides: Partial<ApprovalView> = {}): ApprovalView => ({
    confirmationId: 'confirmation-1',
    status: 'proposed',
    error: null,
    prompt: 'Add a bassline',
    actionLabels: ['Create track Bass'],
    scope: { targetIds: ['track-9'], protectedTargetIds: ['track-1'], protectedRanges: [{ startBeat: 0, endBeat: 4 }] },
    risk: {
        level: 'bounded-reversible',
        decision: 'confirm',
        reasons: ['Adds one track'],
        requiredTrustMode: 'guarded',
    },
    intentGroups: [],
    destructiveChanges: [],
    partialAcceptance: { available: true, reason: null },
    freshness: { status: 'current' },
    rePreview: { available: false, reason: 'The proposal still matches the current project.' },
    consequences: null,
    budgets: null,
    cost: [],
    dataDisclosure: null,
    actor: null,
    expiry: { revision: 'revision-7' },
    createdAt: 10,
    resolvedAt: null,
    ...overrides,
});

type ComparisonSide = 'A' | 'B';
type ComparisonMeasurement = 'web-master' | 'unavailable-native-carrier' | 'unavailable-not-playing';
type ComparisonEndReason = 'user-ended' | 'project-changed' | 'group-reverted' | 'transition-failed' | 'left-on-a';

type ComparisonSession = {
    groupId: string;
    side: ComparisonSide;
    loudness: { a: number | null; b: number | null };
    matchDb: number | null;
    matchLimited: boolean;
    measurement: ComparisonMeasurement;
    transitioning: boolean;
};

type ComparisonEnding = { groupId: string; side: ComparisonSide; reason: ComparisonEndReason };

const comparisonSession = (overrides: Partial<ComparisonSession> = {}): ComparisonSession => ({
    groupId: 'g1',
    side: 'B',
    loudness: { a: null, b: null },
    matchDb: null,
    matchLimited: false,
    measurement: 'web-master',
    transitioning: false,
    ...overrides,
});

function setRuns(runs: AgentRun[]): void {
    agentRunStore.set({ schemaVersion: 1, runs });
}

/**
 * `getAgentChangeComparisonView` and `agentChangeComparisonStore` are mocked
 * independently: the view mock controls what the workspace renders, and the
 * store carries only what the unmount cleanup reads directly. Both need
 * setting to reproduce one real comparison state.
 */
function setComparisonView(active: ComparisonSession | null, lastEnded: ComparisonEnding | null = null): void {
    getAgentChangeComparisonViewMock.mockReturnValue({ active, lastEnded });
    agentChangeComparisonStore.set({ active, lastEnded });
}

beforeEach(() => {
    vi.clearAllMocks();
    agentRunControlsMock.listDecisions.mockReturnValue([]);
    agentRunControlsMock.list.mockReturnValue([]);
    agentRunControlsMock.get.mockReturnValue(null);
    getProviderRouteViewMock.mockReturnValue(null);
    agentChangeComparisonMock.availability.mockReturnValue({ available: true });
    agentChangeComparisonMock.start.mockResolvedValue({ status: 'started' });
    agentChangeComparisonMock.toggle.mockResolvedValue({ status: 'A' });
    agentChangeComparisonMock.end.mockResolvedValue(undefined);
    // Mirrors the real projection: one view per stored confirmation, none for an unknown id.
    getAgentApprovalViewMock.mockImplementation(({ confirmationId }: { confirmationId: string }) => {
        const stored = pendingActionConfirmationStore.value?.confirmations.find(
            (candidate) => candidate.id === confirmationId
        );
        return stored === undefined
            ? null
            : approvalView({
                  confirmationId: stored.id,
                  status: stored.status,
                  prompt: stored.prompt,
                  actionLabels: stored.actionLabels,
              });
    });
    setRuns([]);
    aiActionHistoryStore.set({ groups: [], panelOpen: false });
    pendingActionConfirmationStore.set({ confirmations: [] });
    setComparisonView(null);
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

    it('lists every route option with its admission verdict and the run fallback policy', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        getProviderRouteViewMock.mockReturnValue(routeView());

        const { rerender } = render(<AgentWorkspace />);

        const options = within(screen.getByRole('list', { name: 'Route options' })).getAllByRole('listitem');
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveAttribute('data-admitted', 'false');
        expect(options[0]).toHaveTextContent('webllm: platform-unavailable, model-not-installed');
        expect(options[1]).toHaveAttribute('data-admitted', 'true');
        expect(options[1]).toHaveTextContent('cloud');
        expect(screen.getByText('hosted first, local fallback')).toBeInTheDocument();

        getProviderRouteViewMock.mockReturnValue({ ...routeView(), fallbackPolicy: 'local-only' });
        rerender(<AgentWorkspace />);

        expect(screen.getByText('local only, never widens to a hosted provider')).toBeInTheDocument();
    });

    it('renders the semantic approval view for a pending proposal', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [
                    intentGroup({ id: 'group-a', summary: 'Create the bass track' }),
                    intentGroup({
                        id: 'group-b',
                        summary: 'Add eight notes',
                        affectedTrackIds: ['track-9'],
                        estimatedAudioImpact: { level: 'audible', summary: 'Changes what is heard' },
                        warnings: ['overwrite: replaces two notes'],
                        dependsOnGroupIds: ['group-a'],
                    }),
                ],
                destructiveChanges: [
                    {
                        groupId: 'group-b',
                        classification: 'overwrite',
                        consequence: 'Replaces two notes',
                        recovery: 'inverse',
                    },
                ],
                budgets: { maxCommands: 4, maxCreatedTracks: 1 },
                freshness: { status: 'stale', reason: 'The project moved on.' },
            })
        );

        render(<AgentWorkspace />);

        const groups = within(screen.getByRole('list', { name: 'Intent groups' })).getAllByRole('listitem');
        expect(groups).toHaveLength(2);
        expect(groups[1]).toHaveTextContent('Add eight notes');
        expect(groups[1]).toHaveTextContent('Tracks: track-9');
        expect(groups[1]).toHaveTextContent('audible: Changes what is heard');
        expect(groups[1]).toHaveTextContent('Warnings: overwrite: replaces two notes');
        expect(
            within(screen.getByRole('list', { name: 'Destructive changes' })).getByText(
                'overwrite: Replaces two notes (recovery: inverse)'
            )
        ).toBeInTheDocument();
        expect(screen.getByText('Scope: track-9')).toBeInTheDocument();
        expect(screen.getByText('Protected: track-1')).toBeInTheDocument();
        expect(screen.getByText('Protected ranges: 1')).toBeInTheDocument();
        expect(screen.getByText('Risk: bounded-reversible — confirm')).toBeInTheDocument();
        expect(screen.getByText('Trust mode: guarded')).toBeInTheDocument();
        expect(screen.getByText('Budgets: maxCommands: 4, maxCreatedTracks: 1')).toBeInTheDocument();
        expect(screen.getByText('Valid while project revision revision-7')).toBeInTheDocument();
        expect(screen.getByText('stale')).toHaveAttribute('data-freshness', 'stale');
        expect(screen.getByText('The project moved on.')).toBeInTheDocument();
    });

    it('carries dependents out of a deselected group and re-previews the remaining subset', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [
                    intentGroup({ id: 'group-a', summary: 'Create the bass track' }),
                    intentGroup({ id: 'group-b', summary: 'Add eight notes', dependsOnGroupIds: ['group-a'] }),
                    intentGroup({ id: 'group-c', summary: 'Quantize the notes', dependsOnGroupIds: ['group-b'] }),
                    intentGroup({ id: 'group-d', summary: 'Rename the drum track' }),
                ],
            })
        );

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' }));

        expect(screen.getByRole('checkbox', { name: 'Include group 2: Add eight notes' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Include group 3: Quantize the notes' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Include group 4: Rename the drum track' })).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Re-preview selected agent actions' }));

        expect(reproposePendingChatActionsMock).toHaveBeenCalledExactlyOnceWith({
            confirmationId: 'confirmation-1',
            selectedIntentGroupIds: ['group-d'],
        });
    });

    it('carries dependencies back in when a dependent group is reselected', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [
                    intentGroup({ id: 'group-a', summary: 'Create the bass track' }),
                    intentGroup({ id: 'group-b', summary: 'Add eight notes', dependsOnGroupIds: ['group-a'] }),
                ],
            })
        );

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 2: Add eight notes' }));

        expect(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' })).toBeChecked();
        expect(screen.getByRole('button', { name: 'Re-preview agent actions' })).toBeInTheDocument();
    });

    it('disables the group checkboxes and states the reason when partial acceptance is refused', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [intentGroup({ id: 'group-a', summary: 'Create the bass track' })],
                partialAcceptance: { available: false, reason: 'The batch is one indivisible group.' },
            })
        );

        render(<AgentWorkspace />);

        expect(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' })).toBeDisabled();
        expect(screen.getByText('The batch is one indivisible group.')).toBeInTheDocument();
    });

    it('disables re-preview once every group is unchecked, even while re-preview is available', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [
                    intentGroup({ id: 'group-a', summary: 'Create the bass track' }),
                    intentGroup({ id: 'group-b', summary: 'Add eight notes' }),
                ],
                partialAcceptance: { available: true, reason: null },
                rePreview: { available: true, reason: null },
            })
        );

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 2: Add eight notes' }));

        const rePreviewButton = screen.getByRole('button', { name: 'Re-preview agent actions' });
        expect(rePreviewButton).toBeDisabled();

        fireEvent.click(rePreviewButton);
        expect(reproposePendingChatActionsMock).not.toHaveBeenCalled();
    });

    it('re-previews the whole proposal only when the projection says it is stale', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({ confirmations: [confirmation()] });
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({ intentGroups: [intentGroup({ id: 'group-a', summary: 'Create the bass track' })] })
        );

        const { rerender } = render(<AgentWorkspace />);

        expect(screen.getByRole('button', { name: 'Re-preview agent actions' })).toBeDisabled();
        expect(screen.getByText('The proposal still matches the current project.')).toBeInTheDocument();

        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [intentGroup({ id: 'group-a', summary: 'Create the bass track' })],
                freshness: { status: 'stale', reason: 'The project moved on.' },
                rePreview: { available: true, reason: null },
            })
        );
        rerender(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Re-preview agent actions' }));

        expect(reproposePendingChatActionsMock).toHaveBeenCalledExactlyOnceWith({
            confirmationId: 'confirmation-1',
            selectedIntentGroupIds: undefined,
        });
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

    it('skips a confirmation whose approval view is unavailable instead of rendering a blank card', () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({
            confirmations: [
                confirmation({ id: 'confirmation-1', createdAt: 20 }),
                confirmation({
                    id: 'confirmation-2',
                    createdAt: 10,
                    prompt: 'Add a chorus',
                    actionLabels: ['Create track Chorus'],
                }),
            ],
        });
        getAgentApprovalViewMock.mockImplementation(({ confirmationId }: { confirmationId: string }) =>
            confirmationId === 'confirmation-2' ? null : approvalView({ confirmationId })
        );

        render(<AgentWorkspace />);

        const approvals = within(screen.getByRole('region', { name: 'Approvals' }));
        expect(approvals.getAllByRole('list', { name: 'Proposed actions' })).toHaveLength(1);
        expect(approvals.getByText('Add a bassline')).toBeInTheDocument();
        expect(approvals.queryByText('Add a chorus')).not.toBeInTheDocument();
        expect(approvals.queryByText('Create track Chorus')).not.toBeInTheDocument();
    });

    it("re-previews the clicked card's own subset when two proposals share a run", () => {
        agentRunControlsMock.list.mockReturnValue([projection()]);
        agentRunControlsMock.get.mockReturnValue(projection());
        setRuns([run()]);
        pendingActionConfirmationStore.set({
            confirmations: [
                confirmation({ id: 'confirmation-1', createdAt: 20 }),
                confirmation({
                    id: 'confirmation-2',
                    createdAt: 10,
                    prompt: 'Add a chorus',
                    actionLabels: ['Create track Chorus'],
                }),
            ],
        });
        const viewA = approvalView({
            confirmationId: 'confirmation-1',
            intentGroups: [
                intentGroup({ id: 'group-a1', summary: 'Create the bass track' }),
                intentGroup({ id: 'group-a2', summary: 'Add eight notes', dependsOnGroupIds: ['group-a1'] }),
            ],
        });
        const viewB = approvalView({
            confirmationId: 'confirmation-2',
            prompt: 'Add a chorus',
            intentGroups: [
                intentGroup({ id: 'group-b1', summary: 'Create the chorus section' }),
                intentGroup({ id: 'group-b2', summary: 'Layer harmony vocals', dependsOnGroupIds: ['group-b1'] }),
            ],
        });
        getAgentApprovalViewMock.mockImplementation(({ confirmationId }: { confirmationId: string }) =>
            confirmationId === 'confirmation-2' ? viewB : viewA
        );

        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 2: Layer harmony vocals' }));

        const rePreviewButtons = screen.getAllByRole('button', { name: 'Re-preview selected agent actions' });
        expect(rePreviewButtons).toHaveLength(1);
        fireEvent.click(rePreviewButtons[0]!);

        expect(reproposePendingChatActionsMock).toHaveBeenCalledExactlyOnceWith({
            confirmationId: 'confirmation-2',
            selectedIntentGroupIds: ['group-b1'],
        });
        expect(screen.getByRole('checkbox', { name: 'Include group 1: Create the bass track' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Include group 2: Add eight notes' })).toBeChecked();
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
        getAgentApprovalViewMock.mockReturnValue(
            approvalView({
                intentGroups: [
                    intentGroup({ id: 'group-a', summary: 'Create the bass track' }),
                    intentGroup({ id: 'group-b', summary: 'Add eight notes', dependsOnGroupIds: ['group-a'] }),
                ],
            })
        );
        aiActionHistoryStore.set({ groups: [historyGroup()], panelOpen: false });

        const { container } = render(<AgentWorkspace />);

        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            expect(button).toHaveAccessibleName();
        }

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes.length).toBeGreaterThan(0);
        for (const checkbox of checkboxes) {
            expect(checkbox).toHaveAccessibleName();
        }

        const transitioning = container.querySelectorAll('[class*="transition-"]');
        expect(transitioning.length).toBeGreaterThan(0);
        for (const element of transitioning) {
            expect(element.className).toContain('motion-reduce:transition-none');
        }
    });

    it("enables Compare for an available group and calls start with the group's groupId, not its id; disables with the reason for later-edits", () => {
        // Mutation: swapping `group.groupId` for `group.id` in AgentWorkspace's onCompare wiring turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        const newest = historyGroup({ id: 'group-1', groupId: 'g-newest', prompt: 'Add a bassline', timestamp: 200 });
        const older = historyGroup({ id: 'group-2', groupId: 'g-older', prompt: 'Add a chorus', timestamp: 100 });
        aiActionHistoryStore.set({ groups: [newest, older], panelOpen: false });
        agentChangeComparisonMock.availability.mockImplementation(({ groupId }: { groupId: string }) =>
            groupId === 'g-older' ? { available: false, reason: 'later-edits' } : { available: true }
        );

        render(<AgentWorkspace />);

        const compareNewest = screen.getByRole('button', { name: 'Compare agent changes Add a bassline' });
        expect(compareNewest).toBeEnabled();
        fireEvent.click(compareNewest);
        expect(agentChangeComparisonMock.start).toHaveBeenCalledExactlyOnceWith({ groupId: 'g-newest' });

        const compareOlder = screen.getByRole('button', { name: 'Compare agent changes Add a chorus' });
        expect(compareOlder).toBeDisabled();
        expect(screen.getByText('Newer edits exist')).toBeInTheDocument();
    });

    it('shows the toggle label and pressed state for each side and calls toggle once per click', () => {
        // Mutation: inverting the `active.side === 'A'` branch in the toggle label turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1', side: 'B' }));

        const { rerender } = render(<AgentWorkspace />);

        const toggle = screen.getByRole('button', { name: 'Switch comparison side' });
        expect(toggle).toHaveTextContent('B · after');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle).toHaveAttribute('data-side', 'B');

        fireEvent.click(toggle);
        expect(agentChangeComparisonMock.toggle).toHaveBeenCalledOnce();

        act(() => {
            setComparisonView(comparisonSession({ groupId: 'g1', side: 'A' }));
        });
        rerender(<AgentWorkspace />);

        const toggleOnA = screen.getByRole('button', { name: 'Switch comparison side' });
        expect(toggleOnA).toHaveTextContent('A · before');
        expect(toggleOnA).toHaveAttribute('aria-pressed', 'true');
    });

    it('disables the toggle and announces switching while transitioning', () => {
        // Mutation: dropping the `active.transitioning` branch in `formatStatus` turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1', transitioning: true }));

        render(<AgentWorkspace />);

        const comparisonRegion = within(screen.getByRole('region', { name: 'Agent comparison' }));
        expect(screen.getByRole('button', { name: 'Switch comparison side' })).toBeDisabled();
        expect(comparisonRegion.getByRole('status')).toHaveTextContent('Switching sides');
    });

    it('renders loudness and match readouts, including the fader-headroom note and the not-playing measurement note', () => {
        // Mutation: dropping the `matchLimited` suffix in `formatMatch` turns the first assertion red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(
            comparisonSession({ groupId: 'g1', loudness: { a: -20.1, b: -14 }, matchDb: 6.1, matchLimited: true })
        );

        const { rerender } = render(<AgentWorkspace />);
        const comparisonRegion = within(screen.getByRole('region', { name: 'Agent comparison' }));

        expect(comparisonRegion.getByText('A: -20.1 LUFS')).toBeInTheDocument();
        expect(comparisonRegion.getByText('B: -14.0 LUFS')).toBeInTheDocument();
        expect(comparisonRegion.getByText('Match: +6.1 dB on A (limited by fader headroom)')).toBeInTheDocument();

        act(() => {
            setComparisonView(comparisonSession({ groupId: 'g1', measurement: 'unavailable-not-playing' }));
        });
        rerender(<AgentWorkspace />);

        expect(
            within(screen.getByRole('region', { name: 'Agent comparison' })).getByText(
                'Start playback to measure loudness'
            )
        ).toBeInTheDocument();
    });

    it('states the status text exactly for side A with a negative match', () => {
        // Mutation: dropping the match clause in `formatStatus` turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1', side: 'A', matchDb: -2.0 }));

        render(<AgentWorkspace />);

        expect(within(screen.getByRole('region', { name: 'Agent comparison' })).getByRole('status')).toHaveTextContent(
            'Comparing side A, match -2.0 dB'
        );
    });

    it('ends the comparison once and renders the ending reason once the view goes inactive', async () => {
        // Mutation: mapping `left-on-a` to the wrong text, or dropping `data-ending-reason`, turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1' }));

        render(<AgentWorkspace />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'End comparison' }));
            await Promise.resolve();
        });

        expect(agentChangeComparisonMock.end).toHaveBeenCalledOnce();

        act(() => {
            setComparisonView(null, { groupId: 'g1', side: 'A', reason: 'left-on-a' });
        });

        expect(screen.getByText('Comparison ended on A (before); redo to restore the change')).toHaveAttribute(
            'data-ending-reason',
            'left-on-a'
        );
    });

    it('does not call availability for the active group while a comparison stands', () => {
        // Mutation: removing the `groupId === activeGroupId` short-circuit in `resolveComparisonAvailability` turns this red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        const active = historyGroup({ id: 'group-1', groupId: 'g1', prompt: 'Add a bassline' });
        const other = historyGroup({ id: 'group-2', groupId: 'g2', prompt: 'Add a chorus', timestamp: 50 });
        aiActionHistoryStore.set({ groups: [active, other], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1' }));

        render(<AgentWorkspace />);

        expect(agentChangeComparisonMock.availability).not.toHaveBeenCalledWith({ groupId: 'g1' });
        expect(agentChangeComparisonMock.availability).toHaveBeenCalledWith({ groupId: 'g2' });
    });

    it('ends an active comparison on unmount but not when none is active', () => {
        // Mutation: dropping the unmount cleanup's guard or its `end()` call turns the active case red.
        agentRunControlsMock.list.mockReturnValue([projection()]);
        setRuns([run()]);
        aiActionHistoryStore.set({ groups: [historyGroup({ groupId: 'g1' })], panelOpen: false });
        setComparisonView(comparisonSession({ groupId: 'g1' }));

        const { unmount } = render(<AgentWorkspace />);
        unmount();

        expect(agentChangeComparisonMock.end).toHaveBeenCalledOnce();

        agentChangeComparisonMock.end.mockClear();
        setComparisonView(null);
        const { unmount: unmountInactive } = render(<AgentWorkspace />);
        unmountInactive();

        expect(agentChangeComparisonMock.end).not.toHaveBeenCalled();
    });
});
