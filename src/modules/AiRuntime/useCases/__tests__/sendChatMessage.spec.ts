import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentRunProviderProposal } from '../../models/AgentRun';
import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type planPromptActions } from '../planPromptActions';
import { sendChatMessage } from '../sendChatMessage';

type PlanPromptActionsInput = Parameters<typeof planPromptActions>[0];
type PreparedStemReadiness = 'ready' | 'missing' | 'cleanup-pending';

let plannedRunId: string | null = null;

const mocks = vi.hoisted(() => ({
    aiBackendPreference: { value: 'auto' },
    appendChatMessage: vi.fn(),
    captureProjectRevision: vi.fn(),
    chatState: { value: { chatMode: 'chat', isGenerating: false, messages: [] } },
    compileAgentActionExecution: vi.fn(),
    describeAgentRiskApproval: vi.fn(),
    describePendingActionConfirmation: vi.fn(),
    executeVersionedCommandBatchEnvelope: vi.fn(),
    generateGroupId: vi.fn(),
    getActiveModelId: vi.fn(),
    getLlmEngine: vi.fn(),
    isCloudAvailable: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    planPromptActions: vi.fn(),
    proposePendingActionConfirmation: vi.fn(),
    resolveBackend: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeVersionedCommandBatchEnvelope: mocks.executeVersionedCommandBatchEnvelope,
    generateGroupId: mocks.generateGroupId,
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: mocks.getLlmEngine,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: mocks.getActiveModelId,
}));

vi.mock('../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.aiBackendPreference,
}));

vi.mock('../../stores/chatStore', () => ({
    appendChatMessage: mocks.appendChatMessage,
    chatStore: mocks.chatState,
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../stores/pendingActionConfirmationStore', () => ({
    proposePendingActionConfirmation: mocks.proposePendingActionConfirmation,
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

vi.mock('../compileAgentActionExecution', () => ({
    compileAgentActionExecution: mocks.compileAgentActionExecution,
}));

vi.mock('../describeAgentRiskApproval', () => ({
    describeAgentRiskApproval: mocks.describeAgentRiskApproval,
}));

vi.mock('../describePendingActionConfirmation', () => ({
    describePendingActionConfirmation: mocks.describePendingActionConfirmation,
}));

vi.mock('../planPromptActions', () => ({
    planPromptActions: mocks.planPromptActions,
}));

function createStemImportAction(audioBufferId: string): ExecutableRuntimeAction {
    return {
        type: 'importStemSet',
        payload: {
            selectionId: 'stem-selection-fixture',
            groupName: 'Imported Stems',
            projectTempo: 120,
            folderId: 'folder-imported-stems',
            stems: [
                {
                    stemId: 'stem-kick',
                    sourceName: 'Kick.wav',
                    role: 'kick',
                    sourceTempo: 120,
                    durationSeconds: 8,
                    sourceBytes: 64,
                    decodedBytes: 128,
                    audioBufferId,
                    trackId: 'track-kick',
                    trackName: 'Kick',
                    trackGain: 0.8,
                    trackPan: 0,
                    clipId: 'clip-kick',
                },
            ],
        },
    };
}

function createAddTrackAction(): ExecutableRuntimeAction {
    return {
        type: 'addTrack',
        payload: { name: 'Reference', kind: 'audio' },
    };
}

function createProviderProposal(assetIds: string[]): AgentRunProviderProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Import the prepared stems.',
        constraints: ['Use only the prepared stem selection.'],
        scope: {
            targetIds: [],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        capabilityIds: [],
        assetIds,
        alternatives: [],
        validationStrategy: ['Validate prepared-stem readiness before confirmation.'],
        stoppingConditions: ['Stop if the prepared stem is unavailable.'],
    };
}

function configureCommandPlanning(action: ExecutableRuntimeAction): void {
    const scope = {
        targetIds: [],
        targetRanges: [],
        protectedTargetIds: [],
        protectedRanges: [],
    };
    const grants = {
        allowedOperationPrefixes: [action.type],
        create: true,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: action.type === 'importStemSet',
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    };
    mocks.compileAgentActionExecution.mockReturnValue({
        commandEnvelopes: [],
        commandBatch: { serialized: '{}', authority: { scope, grants } },
        agentApproval: { policy: { risk: 'confirm', reasons: [] } },
        requiresConfirmation: true,
    });
    mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
        status: 'valid',
        envelope: {
            batchId: 'batch-fixture',
            commands: [],
            idempotencyKey: 'batch-fixture-idempotency',
            preconditions: [],
            scope,
        },
    });
}

function configurePromptPlanning(
    action: ExecutableRuntimeAction,
    readiness: PreparedStemReadiness,
    providerProposal?: AgentRunProviderProposal
): void {
    configureCommandPlanning(action);
    mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
        const runId = input.streamIdentity?.runId;
        if (runId === undefined) {
            throw new Error('Expected sendChatMessage to admit the planning run first.');
        }
        plannedRunId = runId;
        if (action.type === 'importStemSet' && readiness !== 'missing') {
            for (const stem of action.payload.stems) {
                agentRunLifecycle.registerTemporaryAsset({
                    runId,
                    assetId: stem.audioBufferId,
                    kind: 'import',
                    cleanupOwner: 'stem-import-preparation',
                });
                if (readiness === 'cleanup-pending') {
                    agentRunLifecycle.prepareTemporaryAssetCleanup({
                        runId,
                        assetId: stem.audioBufferId,
                        cleanupOwner: 'stem-import-preparation',
                    });
                }
            }
        }
        return {
            context: {},
            result: {
                actions: [action],
                rawText: 'fixture plan',
                requiresConfirmation: true,
                ...(providerProposal === undefined ? {} : { providerProposal }),
            },
            projectRevision: 'revision-fixture',
        };
    });
}

function getPlannedRun() {
    if (plannedRunId === null) {
        throw new Error('Expected the planning fixture to capture a run id.');
    }
    const run = agentRunLifecycle.get(plannedRunId);
    if (run === null) {
        throw new Error('Expected the admitted run to remain inspectable.');
    }
    return run;
}

describe('sendChatMessage retained-provider selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentRunLifecycle.clear();
        plannedRunId = null;
        mocks.aiBackendPreference.value = 'auto';
        mocks.chatState.value = { chatMode: 'chat', isGenerating: false, messages: [] };
        mocks.captureProjectRevision.mockReturnValue('revision-fixture');
        mocks.describeAgentRiskApproval.mockReturnValue('Risk approval required.');
        mocks.describePendingActionConfirmation.mockReturnValue({
            actionLabels: ['Fixture action'],
            affectedIds: [],
            protectedUnchanged: [],
            content: 'Fixture confirmation',
        });
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-fixture', groupLabel: 'Fixture group' });
        mocks.getActiveModelId.mockReturnValue('fixture-model');
        mocks.isCloudAvailable.mockReturnValue(false);
        mocks.getLlmEngine.mockReturnValue(null);
        mocks.proposePendingActionConfirmation.mockReturnValue({ id: 'confirmation-fixture' });
        mocks.resolveBackend.mockReturnValue('webllm');
    });

    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('fails closed when the explicitly selected hosted provider is not configured', async () => {
        mocks.aiBackendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'Hosted AI is not configured.'
        );
    });

    it('fails closed when browser WebLLM is selected without an initialized engine', async () => {
        mocks.aiBackendPreference.value = 'webllm';
        mocks.resolveBackend.mockReturnValue('webllm');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'AI Engine is not initialized or not supported on this device.'
        );
    });

    it('forwards same-run live prepared-stem readiness into application planning', async () => {
        configurePromptPlanning(createStemImportAction('buffer-ready'), 'ready');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'selected-stem-assets', source: 'asset', status: 'available' })
        );
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });

    it('admits provider asset ids that name the same-run prepared stems', async () => {
        configurePromptPlanning(createStemImportAction('buffer-ready'), 'ready', createProviderProposal(['stem-kick']));

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'stem-kick', source: 'asset', status: 'available' })
        );
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });

    it('fails closed when a provider asset id does not name a selected prepared stem', async () => {
        configurePromptPlanning(
            createStemImportAction('buffer-ready'),
            'ready',
            createProviderProposal(['stem-provider-invented'])
        );

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('fails closed when the prepared-stem resources are absent', async () => {
        configurePromptPlanning(createStemImportAction('buffer-missing'), 'missing');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('fails closed when prepared-stem resources are pending cleanup', async () => {
        configurePromptPlanning(createStemImportAction('buffer-releasing'), 'cleanup-pending');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('keeps unrelated planning independent of prepared-stem readiness', async () => {
        configurePromptPlanning(createAddTrackAction(), 'missing');

        await sendChatMessage('Add a reference track', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'addTrack', source: 'action-catalog', status: 'available' })
        );
        expect(getPlannedRun().plan?.capabilities).not.toContainEqual(expect.objectContaining({ source: 'asset' }));
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });
});
