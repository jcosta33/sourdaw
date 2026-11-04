import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentResourceLimits, DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { persistAgentRunState, readAgentRunState } from '../../stores/agentRunStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

import {
    assertDiscoveredCommandSchemas,
    catalogDiscoveryCall,
    getApplicationToolReceipts,
    isRecord,
} from './highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn } from './metricGoalWorkflowFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const mocks = vi.hoisted(() => ({
    executionOverride: 'none' as 'ambiguous-before-commit' | 'none',
    obscureCommittedResult: false,
    promotionState: new Map<string, 'prepared' | 'committed' | 'completed'>(),
    observedCommandResult: { value: null as null | { status: string; reason?: string } },
    generateWebLlmCompletion: vi.fn(),
    importStemSetExecute: vi.fn(),
    pickFiles: vi.fn(),
    decodeAudioFile: vi.fn(),
    detectTempo: vi.fn(() => 120),
    stageDurableAsset: vi.fn(),
    prepareDurablePromotionRecovery: vi.fn(),
    commitDurablePromotionRecovery: vi.fn(),
    completeDurablePromotionRecovery: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn(),
    completeDurableCleanupRecovery: vi.fn(),
    prepareDurableCleanupRecovery: vi.fn(),
    promoteStagedAsset: vi.fn(),
    replayOverride: 'real' as 'failed' | 'missing' | 'real',
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));
vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));
vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
}));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    pickFiles: mocks.pickFiles,
}));
vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>()),
    detectTempo: mocks.detectTempo,
}));
vi.mock('#/modules/Command/useCases', async () => {
    const original = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
    async function observeUncommittedBatch<TStatus extends 'ambiguous' | 'failed'>(
        input: Parameters<typeof original.getVersionedCommandBatchCommitProof>[0],
        status: TStatus,
        reason: string
    ) {
        const parsed = original.parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        const proof = await original.getVersionedCommandBatchCommitProof(input);
        const result = { status, reason, actions: [] as [] };
        return {
            ...result,
            receipt: original.createVerifiedBatchReceipt({
                contentHash: proof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: parsed.envelope.baseRevision,
                resultingRevision: null,
                result,
            }),
        };
    }
    return {
        ...original,
        executeUserAppAction: vi.fn(),
        executeVersionedCommandBatchEnvelope: async (
            ...args: Parameters<typeof original.executeVersionedCommandBatchEnvelope>
        ): ReturnType<typeof original.executeVersionedCommandBatchEnvelope> => {
            if (mocks.executionOverride === 'ambiguous-before-commit') {
                const result = await observeUncommittedBatch(
                    args[0],
                    'ambiguous',
                    'Commit truth is not available yet.'
                );
                mocks.observedCommandResult.value = result;
                return result;
            }
            const result = await original.executeVersionedCommandBatchEnvelope(...args);
            mocks.observedCommandResult.value = {
                status: result.status,
                ...('reason' in result ? { reason: result.reason } : {}),
            };
            if (
                mocks.obscureCommittedResult &&
                (result.status === 'committed' || result.status === 'committed-with-warning')
            ) {
                return observeUncommittedBatch(args[0], 'ambiguous', 'The committed receipt channel was interrupted.');
            }

            return result;
        },
        getVersionedCommandBatchIdempotentReplay: async (
            input: Parameters<typeof original.getVersionedCommandBatchIdempotentReplay>[0]
        ): ReturnType<typeof original.getVersionedCommandBatchIdempotentReplay> => {
            if (mocks.replayOverride === 'missing') {
                return null;
            }
            if (mocks.replayOverride === 'failed') {
                return (await observeUncommittedBatch(input, 'failed', 'The retained batch did not commit.')).receipt;
            }
            return original.getVersionedCommandBatchIdempotentReplay(input);
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
// discardPreparedStemImportResources and createStemImportConfirmationResourceLease import getAssetTransfer.
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
        promoteStagedAsset: mocks.promoteStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
        stageDurableAsset: mocks.stageDurableAsset,
    }),
}));

const preparedStem = {
    stemId: 'stem-prompt-recovery',
    sourceName: 'Drums.wav',
    role: 'other',
    sourceTempo: 120,
    durationSeconds: 8,
    sourceBytes: 100,
    decodedBytes: 200,
    audioBufferId: 'buffer-prompt-recovery',
    trackId: 'track-prompt-recovery',
    trackName: 'Drums',
    trackGain: 1,
    trackPan: 0,
    clipId: 'clip-prompt-recovery',
} as const;

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-prompt-recovery',
        groupName: 'Recovered Stems',
        projectTempo: 120,
        folderId: 'folder-prompt-recovery',
        stems: [{ ...preparedStem, assetHash: 'hash-prompt-recovery', assetLeaseId: 'lease-prompt-recovery' }],
    },
} satisfies AppAction;
// Older runs persisted a mixed bound/unbound capsule. New approval rejects that
// incomplete identity, but reload must still retain and reconcile historic media.
const legacyBoundStem = {
    ...preparedStem,
    stemId: 'stem-prompt-recovery-bound',
    audioBufferId: 'buffer-prompt-recovery-bound',
    trackId: 'track-prompt-recovery-bound',
    clipId: 'clip-prompt-recovery-bound',
    assetHash: 'hash-prompt-recovery-bound',
    assetLeaseId: 'lease-prompt-recovery-bound',
} as const;
const legacyUnboundStem = {
    ...preparedStem,
    stemId: 'stem-prompt-recovery-unbound',
    audioBufferId: 'buffer-prompt-recovery-unbound',
    trackId: 'track-prompt-recovery-unbound',
    clipId: 'clip-prompt-recovery-unbound',
} as const;
const legacyStemAction = {
    ...stemAction,
    payload: { ...stemAction.payload, stems: [legacyBoundStem, legacyUnboundStem] },
} satisfies AppAction;
const selectedStemNames = ['Drums_120.wav', 'Bass_120.wav'] as const;
const durableBindings = selectedStemNames.map((name) => ({
    leaseId: `lease-${name}`,
    expectedHash: `hash-${name}`,
}));

function assertStemBudgetReservedBeforeLocalWork() {
    const run = readAgentRunState().runs.find((candidate) => candidate.request === 'Import the selected stems');
    const totalSourceBytes = selectedStemNames.reduce((sum, name) => sum + new File([name], name).size, 0);
    expect(run?.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith('stem-preparation:'))).toMatchObject([
        { attemptId: 'stem-preparation:localAnalysis', category: 'localAnalysis', reserved: 2 },
        {
            attemptId: 'stem-preparation:downloadBytes',
            category: 'downloadBytes',
            reserved: totalSourceBytes,
        },
        {
            attemptId: 'stem-preparation:storageBytes',
            category: 'storageBytes',
            reserved: totalSourceBytes,
        },
    ]);
    expect(run?.budgets.consumed).toMatchObject({ downloadBytes: totalSourceBytes, storageBytes: totalSourceBytes });
}

function getStemImportCapability(userMessage: string) {
    const section = /^capability_schemas:\n(?<payload>.+)$/mu.exec(userMessage)?.groups?.payload;
    if (!section) {
        throw new TypeError('Expected the published capability schemas.');
    }
    const schemas: unknown = JSON.parse(section);
    if (!isRecord(schemas) || typeof schemas.availableCapabilities !== 'string') {
        throw new TypeError('Expected the published available capabilities.');
    }
    const capabilities: unknown = JSON.parse(schemas.availableCapabilities);
    if (!isRecord(capabilities)) {
        throw new TypeError('Expected the published stem-import capability.');
    }
    return capabilities.stemImportCapability;
}

function stemImportProviderTurn(systemPrompt: string, userMessage: string) {
    const receipts = userMessage.includes('application-tool-loop') ? getApplicationToolReceipts(userMessage) : [];
    if (!receipts.some((receipt) => isRecord(receipt) && receipt.toolName === 'selectCreativeInterpretation')) {
        return literalMetricIntakeTurn(userMessage, systemPrompt);
    }
    const selection = withWorkflowCapabilitySelection('stem-import-starting-mix', []);
    const capability = getStemImportCapability(userMessage);
    if (capability === undefined) {
        return selection;
    }
    if (!isRecord(capability) || typeof capability.selectionId !== 'string' || !Array.isArray(capability.stems)) {
        throw new TypeError('Expected the exact prepared stems in the published capability.');
    }
    const stems = capability.stems.map((stem, index) => {
        if (!isRecord(stem) || typeof stem.stemId !== 'string' || stem.sourceName !== selectedStemNames[index]) {
            throw new TypeError('Expected the exact prepared stems in the published capability.');
        }
        return { stemId: stem.stemId, role: index === 0 ? 'kick' : 'bass' };
    });
    if (stems.length !== selectedStemNames.length) {
        throw new TypeError('Expected every selected stem in the published capability.');
    }
    if (!receipts.some((receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover')) {
        return [catalogDiscoveryCall(['importStemSet'])];
    }
    assertDiscoveredCommandSchemas(userMessage, ['importStemSet']);
    return withWorkflowCapabilitySelection('stem-import-starting-mix', [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: [
                    {
                        name: 'importStemSet',
                        arguments: {
                            selectionId: capability.selectionId,
                            groupName: 'Imported Stems',
                            stems,
                        },
                    },
                ],
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Import the exact selected stem set.',
                    constraints: ['Preserve existing project content and let the application assign project IDs.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: ['importStemSet'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Verify the revision, selection, complete roles, and staged assets.'],
                    stoppingConditions: ['Stop when selection, assets, or project revision changes.'],
                },
            },
        },
    ]);
}

async function submitPreparedStemImport() {
    const submission = await submitAdmittedPromptRequest({
        prompt: 'Import the selected stems',
        source: 'prompt-bar',
    });
    if (submission.status !== 'awaiting-approval') {
        throw new TypeError(`Expected approval preview, received ${submission.status}`);
    }
    const confirmation = getPendingActionConfirmation(submission.confirmationId);
    const action = confirmation?.actions[0];
    if (!confirmation || action?.type !== 'importStemSet') {
        throw new TypeError('Expected one planned stem-import confirmation.');
    }
    expect(pendingActionConfirmationStore.value?.confirmations).toHaveLength(1);
    expect(mocks.pickFiles).toHaveBeenCalledOnce();
    expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(2);
    expect(mocks.stageDurableAsset).toHaveBeenCalledTimes(2);
    expect(confirmation.actions).toHaveLength(1);
    expect(action.payload.folderId).toMatch(/^folder-ai-/u);
    expect(action.payload.stems.map((stem) => stem.trackId)).toEqual([
        expect.stringMatching(/^track-ai-/u),
        expect.stringMatching(/^track-ai-/u),
    ]);
    expect(action.payload.stems.map((stem) => stem.clipId)).toEqual([
        expect.stringMatching(/^clip-ai-/u),
        expect.stringMatching(/^clip-ai-/u),
    ]);
    expect(
        action.payload.stems.map((stem) => ({
            sourceName: stem.sourceName,
            role: stem.role,
            assetHash: stem.assetHash,
            assetLeaseId: stem.assetLeaseId,
        }))
    ).toEqual([
        {
            sourceName: selectedStemNames[0],
            role: 'kick',
            assetHash: durableBindings[0]!.expectedHash,
            assetLeaseId: durableBindings[0]!.leaseId,
        },
        {
            sourceName: selectedStemNames[1],
            role: 'bass',
            assetHash: durableBindings[1]!.expectedHash,
            assetLeaseId: durableBindings[1]!.leaseId,
        },
    ]);
    expect(metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState)?.authorities).toMatchObject([
        { kind: 'literal' },
    ]);
    expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
    expect(mocks.importStemSetExecute).not.toHaveBeenCalled();
    expect(mocks.prepareDurablePromotionRecovery).not.toHaveBeenCalled();
    expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
    return { submission, action };
}

function retainLegacyStemRecovery() {
    const runId = `legacy-stem-run-${crypto.randomUUID()}`;
    const batchId = 'legacy-stem-batch';
    const projectRevision = captureProjectRevision();
    agentRunLifecycle.create({ runId, request: 'Import legacy stems', mode: 'plan', createdRevision: projectRevision });
    const { commandBatch } = compilePlannedActionCommandBatch({
        actions: [legacyStemAction],
        actionLabels: ['Import legacy stems'],
        autoCommit: false,
        group: { groupId: batchId, groupLabel: 'Import legacy stems' },
        intent: 'Import legacy stems',
        projectRevision,
        runId,
        context: getProjectContext(),
    });
    preparedStemImportResources.register({ runId, stems: legacyStemAction.payload.stems });
    preparedStemImportResources.retainForRecovery({
        runId,
        stems: legacyStemAction.payload.stems,
        recovery: { batchId, commandBatch },
    });
    return { runId, batchId };
}

describe('prompt stem import recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        mocks.pickFiles.mockResolvedValue(
            selectedStemNames.map((name) => new File([name], name, { type: 'audio/wav' }))
        );
        mocks.decodeAudioFile.mockImplementation((file: File) => {
            assertStemBudgetReservedBeforeLocalWork();
            return Promise.resolve({
                id: `buffer-${file.name}`,
                buffer: { duration: 8, length: 8 * 48_000, numberOfChannels: 2, sampleRate: 48_000 },
            });
        });
        mocks.stageDurableAsset.mockImplementation((_file: File, name: string) => {
            assertStemBudgetReservedBeforeLocalWork();
            return Promise.resolve({ hash: `hash-${name}`, leaseId: `lease-${name}` });
        });
        mocks.promoteStagedAsset.mockResolvedValue({ status: 'promoted' });
        mocks.generateWebLlmCompletion.mockImplementation((systemPrompt: string, userMessage: string) =>
            Promise.resolve(JSON.stringify(stemImportProviderTurn(systemPrompt, userMessage)))
        );
        mocks.executionOverride = 'none';
        mocks.obscureCommittedResult = false;
        mocks.promotionState.clear();
        mocks.observedCommandResult.value = null;
        mocks.replayOverride = 'real';
        mocks.prepareDurablePromotionRecovery.mockImplementation(async (id: string) => {
            mocks.promotionState.set(id, 'prepared');
            return { status: 'prepared' };
        });
        mocks.commitDurablePromotionRecovery.mockImplementation(async (id: string) => {
            mocks.promotionState.set(id, 'committed');
            return { status: 'committed' };
        });
        // Match the durable repository: a prepared claim cannot complete before commit.
        mocks.completeDurablePromotionRecovery.mockImplementation(async (id: string) => {
            if (mocks.promotionState.get(id) !== 'committed') {
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            mocks.promotionState.set(id, 'completed');
            return { status: 'completed' };
        });
        mocks.transitionDurablePromotionRecoveryToCleanup.mockResolvedValue({ status: 'prepared' });
        mocks.completeDurableCleanupRecovery.mockResolvedValue({ status: 'completed' });
        mocks.prepareDurableCleanupRecovery.mockResolvedValue({ status: 'prepared' });
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        window.localStorage.clear();
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('prompt stem recovery test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        clearHandlerRegistry();
        let targetsCreated = false;
        const ownedStorage = createAutomergeStorage<{ imported: boolean }>('owned', 'stemImport');
        registerHandlerMap({
            importStemSet: {
                execute: (action) => {
                    mocks.importStemSetExecute(action);
                    targetsCreated = true;
                    ownedStorage.set({ imported: true });
                },
                canReapplyAfterDivergence: () => true,
                describe: (action) => ({
                    label: 'Import prompt stems',
                    inverseAction: {
                        type: 'discardImportedStemSet',
                        payload: {
                            folderId: action.payload.folderId,
                            stemTrackIds: action.payload.stems.map((stem) => stem.trackId),
                            guards: [],
                        },
                    },
                }),
                requiresAbortCompensation: false,
                undoable: true,
                validate: () => true,
            },
            discardImportedStemSet: {
                execute: () => ownedStorage.set({ imported: false }),
                describe: () => ({ label: 'Discard prompt stems', inverseAction: stemAction }),
                validate: () => true,
                canReapplyAfterDivergence: () => true,
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        resetActionReplayAuthority();
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandBatchPreflightPort.setProvider(({ assetReferences, targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: assetReferences.flatMap((reference) =>
                reference.assetHash ? [reference.assetHash] : []
            ),
            availableAudioBufferIds: assetReferences.flatMap((reference) =>
                reference.audioBufferId ? [reference.audioBufferId] : []
            ),
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: true,
            targetFingerprints: targetsCreated
                ? Object.fromEntries(targetIds.map((targetId) => [targetId, targetId]))
                : {},
        }));
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearHandlerRegistry();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        removeCrdtDoc('owned');
        window.localStorage.clear();
        vi.unstubAllGlobals();
    });

    it('keeps exact durable stem promotion recovery pending when shared approval loses command commit truth', async () => {
        const { submission, action } = await submitPreparedStemImport();
        const runId = submission.runId;
        const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the admitted command batch');
        }
        const confirmationId = submission.confirmationId;
        expect(getPendingActionConfirmation(confirmationId)?.runId).toBe(runId);
        mocks.obscureCommittedResult = true;

        const confirmationResult = await confirmPendingChatActions({ confirmationId });
        expect({ confirmationResult, commandResult: mocks.observedCommandResult.value }).toEqual({
            confirmationResult: { status: 'failed', reason: 'The committed receipt channel was interrupted.' },
            commandResult: { status: 'committed' },
        });

        expect(getPendingActionConfirmation(confirmationId)?.status).toBe('failed');
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
        expect(mocks.importStemSetExecute).toHaveBeenCalledExactlyOnceWith(action);
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`,
            durableBindings,
            expect.objectContaining({ runId, batchId })
        );
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`
        );
        expect(mocks.promotionState.get(`stem-promotion:${submission.confirmationId}`)).toBe('prepared');
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('commits the document and durable promotion through shared approval exactly once', async () => {
        const { submission, action } = await submitPreparedStemImport();
        await expect(confirmPendingChatActions({ confirmationId: submission.confirmationId })).resolves.toEqual({
            status: 'executed',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
        expect(mocks.importStemSetExecute).toHaveBeenCalledExactlyOnceWith(action);
        expect(getPendingActionConfirmation(submission.confirmationId)?.status).toBe('executed');
        expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`
        );
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`
        );
        expect(mocks.promotionState.get(`stem-promotion:${submission.confirmationId}`)).toBe('completed');
        await expect(confirmPendingChatActions({ confirmationId: submission.confirmationId })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'executed',
        });
        expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledTimes(1);
        expect(mocks.importStemSetExecute).toHaveBeenCalledTimes(1);
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('keeps durable stem promotion recovery pending when command commit truth is unavailable before reload', async () => {
        const { submission } = await submitPreparedStemImport();
        const runId = submission.runId;
        const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the admitted command batch');
        }
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(confirmPendingChatActions({ confirmationId: submission.confirmationId })).resolves.toEqual({
            status: 'failed',
            reason: 'Commit truth is not available yet.',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(mocks.importStemSetExecute).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`,
            durableBindings,
            expect.objectContaining({ runId, batchId })
        );
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`
        );
        expect(mocks.promotionState.get(`stem-promotion:${submission.confirmationId}`)).toBe('prepared');
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('retains exact durable prepared-stem promotion recovery after ordinary run history evicts its owner', async () => {
        const { submission } = await submitPreparedStemImport();
        const runId = submission.runId;
        const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the admitted command batch');
        }
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(confirmPendingChatActions({ confirmationId: submission.confirmationId })).resolves.toEqual({
            status: 'failed',
            reason: 'Commit truth is not available yet.',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(mocks.importStemSetExecute).not.toHaveBeenCalled();
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-stem-run-${String(index)}`,
                request: `Later run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-revision-${String(index)}`,
                createdAt: 1_000 + index,
            });
        }
        expect(agentRunLifecycle.get(runId)).toBeNull();
        // Durable stems keep their recovery identity in the durable asset
        // journal, so run-history eviction has nothing of theirs to drop.
        expect(readAgentRunState()).not.toHaveProperty('preparedStemImportRecoveryLedger');
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`,
            durableBindings,
            expect.objectContaining({ runId, batchId })
        );
        // Shared settlement tried to complete the still-prepared journal; the
        // durable owner refused it. Eviction must neither commit nor clean it.
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${submission.confirmationId}`
        );
        expect(mocks.promotionState.get(`stem-promotion:${submission.confirmationId}`)).toBe('prepared');
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

        vi.resetModules();
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        await recoverInterruptedAgentRuns({ recoveredAt: 550 });

        expect(mocks.promotionState.get(`stem-promotion:${submission.confirmationId}`)).toBe('prepared');
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('refuses new canonical approval with incomplete durable stem identities', async () => {
        mocks.stageDurableAsset.mockImplementationOnce((_file: File, name: string) =>
            Promise.resolve({ hash: `hash-${name}`, leaseId: `lease-${name}` })
        );
        mocks.stageDurableAsset.mockImplementationOnce((_file: File, name: string) =>
            Promise.resolve({ hash: `hash-${name}`, leaseId: '' })
        );
        await expect(
            submitAdmittedPromptRequest({
                prompt: 'Import the selected stems',
                source: 'prompt-bar',
            })
        ).rejects.toThrow('Prepared stem durable asset binding is incomplete');
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
        expect(mocks.prepareDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-cleanup:["${durableBindings[0]!.leaseId}"]`,
            [durableBindings[0]]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-cleanup:["${durableBindings[0]!.leaseId}"]`
        );
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('refuses an over-budget selected stem set before decoding or staging either file', async () => {
        const limits: AgentResourceLimits = { ...DEFAULT_AGENT_RESOURCE_LIMITS, storageBytes: 1 };
        agentResourceLimitsStore.set(limits);
        const beforeRevision = captureProjectRevision();

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Import the selected stems', source: 'prompt-bar' })
        ).rejects.toThrow('The selected stem preparation exceeds the user budget.');

        const run = readAgentRunState().runs.find((candidate) => candidate.request === 'Import the selected stems');
        if (!run) {
            throw new TypeError('Expected the admitted Prompt Bar run.');
        }
        expect(mocks.pickFiles).toHaveBeenCalledOnce();
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.stageDurableAsset).not.toHaveBeenCalled();
        expect(run.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith('stem-preparation:'))).toEqual([]);
        expect(run.budgets.consumed.downloadBytes).toBeUndefined();
        expect(run.budgets.consumed.storageBytes).toBeUndefined();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(captureProjectRevision()).toBe(beforeRevision);
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });

    it('leaves the project unchanged when the selected-stem picker is cancelled', async () => {
        mocks.pickFiles.mockResolvedValueOnce(null);

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Import the selected stems', source: 'prompt-bar' })
        ).resolves.toMatchObject({ status: 'no-op' });

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.stageDurableAsset).not.toHaveBeenCalled();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });

    it('rejects an invalid one-file selection before decoding or staging', async () => {
        mocks.pickFiles.mockResolvedValueOnce([new File(['drums'], selectedStemNames[0], { type: 'audio/wav' })]);

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Import the selected stems', source: 'prompt-bar' })
        ).rejects.toThrow('Select between 2 and 32 audio stems.');

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.stageDurableAsset).not.toHaveBeenCalled();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('stemImport');
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });

    it('reconstructs an evicted prepared-stem capsule after reload and discards it on proven noncommit', async () => {
        const { runId, batchId } = retainLegacyStemRecovery();
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-stem-run-${String(index)}`,
                request: `Later run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-revision-${String(index)}`,
                createdAt: 1_000 + index,
            });
        }
        expect(agentRunLifecycle.get(runId)).toBeNull();
        expect(readAgentRunState()).toMatchObject({
            preparedStemImportRecoveryLedger: [
                {
                    runId,
                    batchId,
                    serializedCommandBatch: expect.any(String),
                    resources: [
                        {
                            audioBufferId: 'buffer-prompt-recovery-bound',
                            assetLeaseId: 'lease-prompt-recovery-bound',
                        },
                        {
                            audioBufferId: 'buffer-prompt-recovery-unbound',
                            assetLeaseId: null,
                        },
                    ],
                },
            ],
        });

        vi.resetModules();
        mocks.replayOverride = 'failed';
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { readAgentRunState: readReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverInterruptedAgentRuns({ recoveredAt: 550 });
        await recoverInterruptedAgentRuns({ recoveredAt: 551 });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-prompt-recovery-bound');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-prompt-recovery-unbound');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('lease-prompt-recovery-bound');
        expect(readReloadedAgentRunState()).not.toHaveProperty('preparedStemImportRecoveryLedger');
    });

    it('surfaces manual repair without deleting retained media when an evicted capsule is invalid', async () => {
        const { runId } = retainLegacyStemRecovery();
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-manual-run-${String(index)}`,
                request: `Later manual run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-manual-revision-${String(index)}`,
                createdAt: 2_000 + index,
            });
        }
        const evictedState = readAgentRunState();
        const capsule = evictedState.preparedStemImportRecoveryLedger?.[0];
        if (!capsule) {
            throw new TypeError('Expected an independently retained prepared-stem capsule');
        }
        persistAgentRunState({
            ...evictedState,
            preparedStemImportRecoveryLedger: [
                {
                    ...capsule,
                    serializedCommandBatch: 'invalid retained command proof',
                },
            ],
        });

        vi.resetModules();
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { readAgentRunState: readReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverInterruptedAgentRuns({ recoveredAt: 575 });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(readReloadedAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({
                runId,
                batchId: capsule.batchId,
                status: 'manual-repair',
                lastError: expect.stringContaining('Keep the staged media retained'),
                resources: [
                    {
                        audioBufferId: 'buffer-prompt-recovery-bound',
                        assetLeaseId: 'lease-prompt-recovery-bound',
                    },
                    {
                        audioBufferId: 'buffer-prompt-recovery-unbound',
                        assetLeaseId: null,
                    },
                ],
            }),
        ]);

        const firstReloadedCapsule = readReloadedAgentRunState().preparedStemImportRecoveryLedger?.[0];
        if (!firstReloadedCapsule) {
            throw new TypeError('Expected the manual-repair capsule after first recovery');
        }
        vi.resetModules();
        const { recoverInterruptedAgentRuns: recoverAfterSecondReload } = await import('../agentRunRecovery');
        const { readAgentRunState: readSecondReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverAfterSecondReload({ recoveredAt: 576 });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(readSecondReloadedAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({
                runId: firstReloadedCapsule.runId,
                batchId: firstReloadedCapsule.batchId,
                serializedCommandBatch: firstReloadedCapsule.serializedCommandBatch,
                status: 'manual-repair',
                resources: firstReloadedCapsule.resources,
            }),
        ]);
    });

    it('fails closed after reload when a legacy prepared stem asset has no recovery metadata', async () => {
        const runId = 'legacy-prepared-stem-run';
        agentRunLifecycle.create({
            runId,
            request: 'Import legacy stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        agentRunLifecycle.registerTemporaryAsset({
            runId,
            assetId: 'legacy-buffer',
            kind: 'import',
            cleanupOwner: 'stem-import-preparation',
        });

        vi.resetModules();
        mocks.replayOverride = 'missing';
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { agentRunLifecycle: reloadedAgentRunLifecycle } = await import('../agentRunLifecycle');

        await recoverInterruptedAgentRuns({ recoveredAt: 600 });

        expect(reloadedAgentRunLifecycle.get(runId)).toMatchObject({
            manualResume: { required: true },
            errors: expect.arrayContaining([
                expect.objectContaining({ code: 'prepared-stem-recovery-metadata-missing' }),
            ]),
            preparedStemImports: [],
            temporaryAssets: [expect.objectContaining({ assetId: 'legacy-buffer', status: 'cleanup-pending' })],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });
});
