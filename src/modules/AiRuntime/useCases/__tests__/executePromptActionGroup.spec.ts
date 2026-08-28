import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    type getVersionedCommandBatchCommitProof,
    type parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { readAgentRunState } from '../../stores/agentRunStore';
import {
    AGENT_RUN_COMPLETION_PERSISTENCE_WARNING,
    AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
    AGENT_RUN_STALE_FAILURE_WARNING,
} from '../agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { compilePendingActionCommandEnvelopes } from '../compilePendingActionCommandEnvelopes';
import { executePromptActionGroup } from '../executePromptActionGroup';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import * as receiptSaga from '../recordAgentRunReceiptSaga';

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-2' },
    executePlannedActions: vi.fn(),
    notifyAiChange: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    getVersionedCommandBatchCommitProof: vi.fn(),
    issueApprovalBinding: vi.fn(() => ({ token: 'exact-approval' })),
    prepareDurablePromotionRecovery: vi.fn(),
    commitDurablePromotionRecovery: vi.fn(),
    completeDurablePromotionRecovery: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn(),
    completeDurableCleanupRecovery: vi.fn(),
    protectPreparedStemImportResources: vi.fn(),
    retainPreparedStemImportResources: vi.fn(),
    releasePreparedStemImportResources: vi.fn(),
    discardPreparedStemImportResources: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    generateGroupId: () => ({ groupId: 'group-1', groupLabel: 'Prompt action' }),
    isExecutableAppActionType: (type: string) => type !== 'removeAllTracks',
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
    getVersionedCommandBatchCommitProof: mocks.getVersionedCommandBatchCommitProof,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
    }),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));
vi.mock('../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));
vi.mock('../agentReference/registerPreparedStemImportResources', () => ({
    preparedStemImportResources: {
        protect: mocks.protectPreparedStemImportResources,
        retainForRecovery: mocks.retainPreparedStemImportResources,
        release: mocks.releasePreparedStemImportResources,
        discard: mocks.discardPreparedStemImportResources,
    },
}));

const RUN_ID = 'prompt-run-1';
const BATCH_ID = 'batch-1';
const IDEMPOTENCY_KEY = 'batch-key-1';
const RUNTIME_BATCH_ID = 'runtime-batch-1';
const RUNTIME_IDEMPOTENCY_KEY = 'runtime-batch-key-1';
const BASE_REVISION = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});
const runtimeAction = { type: 'stopPlayback' } satisfies AppAction;
const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-1',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-1',
        stems: [
            {
                stemId: 'stem-1',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 10,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-1',
                assetHash: 'asset-hash-1',
                assetLeaseId: 'asset-lease-1',
                trackId: 'track-1',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-1',
            },
        ],
    },
} satisfies AppAction;
type CommandBatch = ReturnType<typeof compileVersionedCommandBatchEnvelope>;
type ParsedCommandBatch = ReturnType<typeof parseVersionedCommandBatchEnvelope>;
type ReceiptEnvelope = Extract<ParsedCommandBatch, { status: 'valid' }>['envelope'];
type DurableCommitProof = Awaited<ReturnType<typeof getVersionedCommandBatchCommitProof>>;
type BatchFixture = {
    actions: readonly AppAction[];
    commandBatch: CommandBatch;
    envelope: ReceiptEnvelope;
    proof: DurableCommitProof;
};
type BatchFixtures = {
    stem: BatchFixture;
    runtime: BatchFixture;
    differentRun: BatchFixture;
    differentBatch: BatchFixture;
};
type CommandUseCases = typeof import('#/modules/Command/useCases');
type AgentApproval = Parameters<typeof executePromptActionGroup>[0]['prepared']['agentApproval'];

let batchFixtures: BatchFixtures | null = null;

function getBatchFixtures(): BatchFixtures {
    if (batchFixtures === null) {
        throw new Error('Expected the production-compiled command batch fixtures');
    }
    return batchFixtures;
}

function getReceiptCommandFixture(fixture: BatchFixture): ReceiptEnvelope['commands'][number] {
    const command = fixture.envelope.commands[0];
    if (!command) {
        throw new Error('Expected the parsed batch to contain its compiled command');
    }
    return command;
}

async function compileBatchFixture(
    commandUseCases: CommandUseCases,
    input: {
        actions: readonly AppAction[];
        actionLabels: readonly string[];
        batchId: string;
        idempotencyKey: string;
        intent: string;
        runId: string;
    }
): Promise<BatchFixture> {
    const commands = compilePendingActionCommandEnvelopes({
        actions: input.actions,
        actionLabels: input.actionLabels,
        group: { groupId: input.batchId, groupLabel: input.intent },
        projectRevision: BASE_REVISION,
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input.runId,
        batchId: input.batchId,
        projectId: 'project:test',
        baseRevision: BASE_REVISION,
        idempotencyKey: input.idempotencyKey,
        intent: input.intent,
        commands,
    });
    const parsed = commandUseCases.parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return {
        actions: input.actions,
        commandBatch,
        envelope: parsed.envelope,
        proof: await commandUseCases.getVersionedCommandBatchCommitProof(commandBatch),
    };
}

function seedRun(fixture: BatchFixture, phase: 'planning' | 'waiting-for-approval' = 'planning'): void {
    const command = getReceiptCommandFixture(fixture);
    const batch = fixture.commandBatch;
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: fixture.envelope.intent,
        mode: 'apply',
        createdRevision: 'revision-1',
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning', revision: 'revision-1' });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: fixture.envelope.intent,
        commandIds: [command.commandId],
        serializedBatchIdentity: fixture.envelope.idempotencyKey,
        revision: 'revision-1',
        scope: {
            targetIds: [...batch.authority.scope.targetIds],
            targetRanges: batch.authority.scope.targetRanges.map((range) => ({ ...range })),
            protectedTargetIds: [...batch.authority.scope.protectedTargetIds],
            protectedRanges: batch.authority.scope.protectedRanges.map((range) => ({ ...range })),
        },
        grants: {
            ...batch.authority.grants,
            allowedOperationPrefixes: [...batch.authority.grants.allowedOperationPrefixes],
        },
        budgets: { limits: {}, consumed: {} },
        recordedAt: 101,
    });
    agentRunLifecycle.recordBatch({
        runId: RUN_ID,
        batch: {
            batchId: fixture.envelope.batchId,
            commandIds: [command.commandId],
            status: phase === 'waiting-for-approval' ? 'waiting-for-approval' : 'planned',
            receiptIdentity: null,
        },
        recordedAt: 102,
    });
    if (phase === 'waiting-for-approval') {
        agentRunLifecycle.transitionPhase({
            runId: RUN_ID,
            phase: 'waiting-for-approval',
            revision: 'revision-1',
        });
    }
}

function admitted(fixture: BatchFixture, agentApproval: AgentApproval = null) {
    return {
        runId: RUN_ID,
        prepared: {
            commandBatch: fixture.commandBatch,
            agentApproval,
            requiresConfirmation: agentApproval !== null,
        },
    };
}

type VerifiedReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type ReceiptResult = Parameters<typeof createVerifiedBatchReceipt>[0]['result'];
type PendingEffect = NonNullable<ReceiptResult['warningDetails']>[number]['pendingEffect'];
type ExternalPendingEffect = Extract<NonNullable<PendingEffect>, { kind: 'external-effect' }>;

function buildVerifiedReceipt(input: { fixture: BatchFixture; result: ReceiptResult }): VerifiedReceipt {
    return createVerifiedBatchReceipt({
        contentHash: input.fixture.proof.contentHash,
        envelope: input.fixture.envelope,
        observedBaseRevision: BASE_REVISION,
        resultingRevision: 'revision-2',
        result: input.result,
    });
}

function receiptAction(fixture: BatchFixture) {
    const action = fixture.actions[0];
    if (!action) {
        throw new Error('Expected the batch fixture to contain its compiled action');
    }
    const command = getReceiptCommandFixture(fixture);
    return {
        action,
        receipt: createVersionedCommandReceipt({
            envelope: command,
            compensation:
                action.type === 'importStemSet'
                    ? { available: true, strategy: 'inverse' }
                    : { available: false, strategy: 'none' },
        }),
    };
}

function committedReceipt(fixture: BatchFixture): VerifiedReceipt {
    return buildVerifiedReceipt({
        fixture,
        result: { status: 'committed', actions: [receiptAction(fixture)] },
    });
}

function executedReceipt(fixture: BatchFixture): VerifiedReceipt {
    return buildVerifiedReceipt({
        fixture,
        result: { status: 'executed', actions: [receiptAction(fixture)] },
    });
}

function pendingEffect(
    fixture: BatchFixture,
    remediation: ExternalPendingEffect['remediation'] = 'reconcile'
): ExternalPendingEffect {
    const command = getReceiptCommandFixture(fixture);
    return {
        commandId: command.commandId,
        kind: 'external-effect',
        operation: command.operation,
        reason: 'Imported stem runtime reconciliation remains incomplete',
        remediation,
        state: 'pending',
    };
}

describe('executePromptActionGroup', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        agentRunLifecycle.clear();
        registerHandlerMap({
            importStemSet: getArrangementHandlers().importStemSet,
            stopPlayback: getTransportHandlers().stopPlayback,
        } satisfies Parameters<typeof registerHandlerMap>[0]);
        const commandUseCases =
            await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        batchFixtures = {
            stem: await compileBatchFixture(commandUseCases, {
                actions: [stemAction],
                actionLabels: ['Import stems'],
                runId: RUN_ID,
                batchId: BATCH_ID,
                idempotencyKey: IDEMPOTENCY_KEY,
                intent: 'Import stems',
            }),
            runtime: await compileBatchFixture(commandUseCases, {
                actions: [runtimeAction],
                actionLabels: ['Stop playback'],
                runId: RUN_ID,
                batchId: RUNTIME_BATCH_ID,
                idempotencyKey: RUNTIME_IDEMPOTENCY_KEY,
                intent: 'Stop playback',
            }),
            differentRun: await compileBatchFixture(commandUseCases, {
                actions: [stemAction],
                actionLabels: ['Import stems'],
                runId: 'different-run',
                batchId: BATCH_ID,
                idempotencyKey: 'different-run-batch-key',
                intent: 'Import stems',
            }),
            differentBatch: await compileBatchFixture(commandUseCases, {
                actions: [stemAction],
                actionLabels: ['Import stems'],
                runId: RUN_ID,
                batchId: 'different-batch',
                idempotencyKey: 'different-batch-key',
                intent: 'Import stems',
            }),
        };
        const fixtures = getBatchFixtures();
        mocks.projectRevision.value = 'revision-2';
        mocks.issueApprovalBinding.mockReturnValue({ token: 'exact-approval' });
        mocks.getVersionedCommandBatchCommitProof.mockResolvedValue(fixtures.stem.proof);
        mocks.prepareDurablePromotionRecovery.mockResolvedValue({ status: 'prepared' });
        mocks.commitDurablePromotionRecovery.mockResolvedValue({ status: 'committed' });
        mocks.completeDurablePromotionRecovery.mockResolvedValue({ status: 'completed' });
        mocks.transitionDurablePromotionRecoveryToCleanup.mockResolvedValue({ status: 'prepared' });
        mocks.completeDurableCleanupRecovery.mockResolvedValue({ status: 'completed' });
        mocks.parseVersionedCommandBatchEnvelope.mockImplementation(commandUseCases.parseVersionedCommandBatchEnvelope);
    });

    afterEach(() => {
        clearHandlerRegistry();
        batchFixtures = null;
    });

    it('binds the exact application-issued approval to the admitted command batch', async () => {
        const fixture = getBatchFixtures().stem;
        const command = getReceiptCommandFixture(fixture);
        const approval = {
            schemaVersion: 1,
            actionHashes: [getExactAgentActionHash({ operation: command.operation, arguments: command.arguments })],
            sourceRevision: fixture.envelope.baseRevision,
            targetFingerprints: {},
            advertisedTargetFingerprints: {},
            consequences: {
                audioUpload: fixture.envelope.grants.audioUpload,
                fileAccess: fixture.envelope.grants.file,
                maxImportedAssets: fixture.envelope.budgets.maxImportedAssets,
                maxRenderJobs: fixture.envelope.budgets.maxRenderJobs,
                remoteGeneration: fixture.envelope.grants.remoteGeneration,
            },
            localActorId: 'artist-1',
            policy: {
                decision: 'confirm',
                reasons: ['The planning workflow requires explicit confirmation.'],
                requiredTrustMode: 'destructive-commit',
                risk: 'external-effect',
            },
        } satisfies NonNullable<AgentApproval>;
        seedRun(fixture, 'waiting-for-approval');
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [],
            receipt: committedReceipt(fixture),
        });

        await executePromptActionGroup({
            actions: fixture.actions,
            prompt: 'Import stems',
            projectRevision: 'revision-1',
            ...admitted(fixture, approval),
        });

        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({ approval, commandBatch: fixture.commandBatch });
        expect(mocks.executePlannedActions).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: RUN_ID,
                commandBatch: expect.objectContaining({ approvalBinding: { token: 'exact-approval' } }),
            })
        );
    });

    it('completes durable stem promotion recovery after an exact verified committed receipt without deleting media', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
            receipt: committedReceipt(fixture),
        });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(mocks.getVersionedCommandBatchCommitProof).toHaveBeenCalledExactlyOnceWith(fixture.commandBatch);
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`,
            [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }],
            fixture.proof
        );
        expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it('prepares durable stem promotion before command execution can reach project commit', async () => {
        const controller = new AbortController();
        const order: string[] = [];
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.prepareDurablePromotionRecovery.mockImplementation(async () => {
            order.push('prepared');
            return { status: 'prepared' };
        });
        mocks.commitDurablePromotionRecovery.mockImplementation(async () => {
            order.push('committed');
            return { status: 'committed' };
        });
        mocks.completeDurablePromotionRecovery.mockImplementation(async () => {
            order.push('completed');
            return { status: 'completed' };
        });
        mocks.releasePreparedStemImportResources.mockImplementation(() => order.push('legacy-released'));
        mocks.executePlannedActions.mockImplementation(async () => {
            order.push('post-commit');
            controller.abort();
            await Promise.resolve();
            return {
                status: 'committed',
                actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
                receipt: committedReceipt(fixture),
            };
        });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                signal: controller.signal,
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(order).toEqual(['legacy-released', 'prepared', 'post-commit', 'committed', 'completed']);
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each([
        { execution: { status: 'invalidated', reason: 'Revision changed' }, outcome: 'failed' },
        { execution: { status: 'failed', reason: 'Execution failed' }, outcome: 'failed' },
        { execution: { status: 'cancelled' }, outcome: 'cancelled' },
        { execution: { status: 'no-op' }, outcome: 'no-op' },
    ] as const)(
        'transitions durable stem promotion recovery to cleanup after a non-committed $execution.status terminal',
        async ({ execution, outcome }) => {
            const fixture = getBatchFixtures().stem;
            seedRun(fixture);
            mocks.executePlannedActions.mockResolvedValue(execution);

            await expect(
                executePromptActionGroup({
                    actions: fixture.actions,
                    prompt: 'Import stems',
                    projectRevision: 'revision-1',
                    ...admitted(fixture),
                })
            ).resolves.toEqual({ status: outcome });

            expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
                runId: RUN_ID,
                stems: stemAction.payload.stems,
            });
            expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
            expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`,
                [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
            );
            expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`
            );
            expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        }
    );

    it('retains prepared stem recovery ownership for an ambiguous execution outcome', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue({ status: 'ambiguous', reason: 'Commit truth is unresolved' });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'ambiguous' });

        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.retainPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each([
        {
            fixture: 'stem',
            receiptOutcome: 'committed',
            result: { status: 'committed', actions: [] },
            phase: 'completed',
            committedRevision: 'revision-2',
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '2:prompt-run-1:batch-1:committed',
            notification: null,
        },
        {
            fixture: 'runtime',
            receiptOutcome: 'executed',
            result: { status: 'executed', actions: [] },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '2:prompt-run-1:runtime-batch-1:executed',
            notification: null,
        },
        {
            fixture: 'stem',
            receiptOutcome: undefined,
            result: { status: 'invalidated', reason: 'Revision changed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: { message: 'Command not executed: Revision changed', actions: [] },
        },
        {
            fixture: 'stem',
            receiptOutcome: undefined,
            result: { status: 'failed', reason: 'Execution failed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: { message: 'Command not executed: Execution failed', actions: [] },
        },
        {
            fixture: 'stem',
            receiptOutcome: undefined,
            result: { status: 'ambiguous', reason: 'Receipt missing' },
            phase: 'partially-completed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: {
                message: 'Command outcome is uncertain: Receipt missing. Inspect the project before retrying.',
                actions: [],
            },
        },
        {
            fixture: 'stem',
            receiptOutcome: undefined,
            result: { status: 'cancelled' },
            phase: 'cancelled',
            committedRevision: null,
            batchStatus: 'cancelled',
            leaseState: 'cancelled',
            receiptIdentity: null,
            notification: {
                message: 'Command cancelled before it committed. No project changes were applied.',
                actions: [],
            },
        },
        {
            fixture: 'stem',
            receiptOutcome: undefined,
            result: { status: 'no-op' },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'no-op',
            leaseState: 'completed',
            receiptIdentity: null,
            notification: { message: 'No project changes were needed.', actions: [] },
        },
    ])(
        'reconciles $result.status to exact run, batch, lease, receipt, and notification truth',
        async ({
            fixture,
            receiptOutcome,
            result,
            phase,
            committedRevision,
            batchStatus,
            leaseState,
            receiptIdentity,
            notification,
        }) => {
            const exactFixture = fixture === 'runtime' ? getBatchFixtures().runtime : getBatchFixtures().stem;
            seedRun(exactFixture);
            let receipt: VerifiedReceipt | undefined;
            if (receiptOutcome === 'committed') {
                receipt = committedReceipt(exactFixture);
            } else if (receiptOutcome === 'executed') {
                receipt = executedReceipt(exactFixture);
            }
            const exactResult = receipt ? { ...result, receipt } : result;
            mocks.executePlannedActions.mockResolvedValue(exactResult);

            await expect(
                executePromptActionGroup({
                    actions: exactFixture.actions,
                    prompt: exactFixture.envelope.intent,
                    projectRevision: 'revision-1',
                    ...admitted(exactFixture),
                })
            ).resolves.toEqual({ status: exactResult.status === 'invalidated' ? 'failed' : exactResult.status });

            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase,
                revisions: { committed: committedRevision },
                batches: [{ batchId: exactFixture.envelope.batchId, status: batchStatus, receiptIdentity }],
                workLeases: [
                    {
                        runId: RUN_ID,
                        workId: exactFixture.envelope.batchId,
                        idempotencyKey: exactFixture.envelope.idempotencyKey,
                        terminalState: leaseState,
                    },
                ],
            });
            if (notification === null) {
                expect(mocks.notifyAiChange).not.toHaveBeenCalled();
            } else {
                expect(mocks.notifyAiChange).toHaveBeenCalledWith(notification.message, notification.actions);
            }
        }
    );

    it('persists the exact command batch for pending-effect continuation after a committed receipt', async () => {
        const fixture = getBatchFixtures().stem;
        const effect = pendingEffect(fixture);
        const receipt = buildVerifiedReceipt({
            fixture,
            result: {
                status: 'committed-with-warning',
                actions: [receiptAction(fixture)],
                warning: 'A post-commit effect remains pending.',
                warningDetails: [
                    {
                        kind: 'external-effect',
                        commandId: effect.commandId,
                        message: 'A post-commit effect remains pending.',
                        pendingEffect: effect,
                    },
                ],
            },
        });
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
            receipt,
        });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'committed' });

        const expectedContinuation = {
            batchId: BATCH_ID,
            effects: [effect],
            recovery: 'reconcile-batch',
            serializedBatch: fixture.commandBatch.serialized,
            authority: fixture.commandBatch.authority,
        };
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [expectedContinuation],
        });
        expect(readAgentRunState().runs.find((run) => run.runId === RUN_ID)).toMatchObject({
            pendingEffectContinuations: [expectedContinuation],
        });
    });

    it('exposes manual repair instead of a reconcile-batch continuation for a manual-repair receipt', async () => {
        const fixture = getBatchFixtures().stem;
        const effect = pendingEffect(fixture, 'manual-repair');
        const receipt = buildVerifiedReceipt({
            fixture,
            result: {
                status: 'committed-with-warning',
                actions: [receiptAction(fixture)],
                warning: 'Manual repair required.',
                warningDetails: [
                    {
                        kind: 'external-effect',
                        commandId: effect.commandId,
                        message: 'Manual repair required.',
                        pendingEffect: effect,
                    },
                ],
            },
        });
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
            receipt,
        });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'committed' });

        const expectedContinuation = {
            batchId: BATCH_ID,
            effects: [effect],
            recovery: 'manual-repair',
            serializedBatch: fixture.commandBatch.serialized,
            authority: fixture.commandBatch.authority,
        };
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ pendingEffectContinuations: [expectedContinuation] });
        expect(agentRunLifecycle.get(RUN_ID)?.pendingEffectContinuations).not.toContainEqual(
            expect.objectContaining({ recovery: 'reconcile-batch' })
        );
        const persistedRun = readAgentRunState().runs.find((run) => run.runId === RUN_ID);
        expect(persistedRun).toMatchObject({ pendingEffectContinuations: [expectedContinuation] });
        expect(persistedRun?.pendingEffectContinuations).not.toContainEqual(
            expect.objectContaining({ recovery: 'reconcile-batch' })
        );
    });

    it.each([
        {
            label: 'missing',
            receiptFixture: null,
            warning:
                'Command outcome is uncertain: Command execution completed without an exact verified receipt. Inspect the project before retrying.',
        },
        {
            label: 'different-run',
            receiptFixture: 'differentRun',
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
        {
            label: 'different-batch',
            receiptFixture: 'differentBatch',
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
    ])('keeps a $label committed receipt outcome uncertain', async ({ receiptFixture, warning }) => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        let receipt: VerifiedReceipt | undefined;
        if (receiptFixture === 'differentRun') {
            receipt = committedReceipt(getBatchFixtures().differentRun);
        } else if (receiptFixture === 'differentBatch') {
            receipt = committedReceipt(getBatchFixtures().differentBatch);
        }
        mocks.executePlannedActions.mockResolvedValue({ status: 'committed', actions: [], receipt });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'ambiguous' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            revisions: { committed: null },
            batches: [{ batchId: BATCH_ID, status: 'failed', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: 'failed' }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledTimes(1);
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(warning, []);
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.retainPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it('reconciles a thrown execution before propagating the failure', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.executePlannedActions.mockRejectedValue(new Error('Executor crashed'));

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).rejects.toThrow('Executor crashed');

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: 'failed' }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Command not executed: Executor crashed', []);
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`,
            [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'stale', settle: () => ({ status: 'stale' as const }), warning: AGENT_RUN_STALE_FAILURE_WARNING },
        {
            label: 'persistence fails',
            settle: () => {
                throw new Error('Lease storage unavailable');
            },
            warning: AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
        },
    ])('preserves a thrown command failure when failed settlement is $label', async ({ settle, warning }) => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        const executionError = new Error('Executor crashed');
        mocks.executePlannedActions.mockRejectedValue(executionError);
        vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(settle);

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).rejects.toBe(executionError);

        expect(mocks.notifyAiChange).toHaveBeenCalledWith(`Command not executed: Executor crashed. ${warning}`, []);
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'executing',
            batches: [{ batchId: BATCH_ID, status: 'executing', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: null }],
        });
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`,
            [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
    });

    it('preserves an executor error when clean settlement terminal lifecycle persistence fails', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        const executionError = new Error('Executor crashed');
        mocks.executePlannedActions.mockRejectedValue(executionError);
        const updateBatchStatus = agentRunLifecycle.updateBatchStatus;
        vi.spyOn(agentRunLifecycle, 'updateBatchStatus').mockImplementation((input) => {
            if (input.status === 'failed') {
                throw new Error('Terminal batch storage unavailable');
            }
            updateBatchStatus(input);
        });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).rejects.toBe(executionError);

        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            `Command not executed: Executor crashed. ${AGENT_RUN_FAILURE_PERSISTENCE_WARNING}`,
            []
        );
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`,
            [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
    });

    it.each([
        {
            label: 'ambiguous execution',
            execution: { status: 'ambiguous' as const, reason: 'Commit truth is unresolved' },
            outcome: 'ambiguous' as const,
            notification: `Command outcome is uncertain: Commit truth is unresolved. Inspect the project before retrying. ${AGENT_RUN_FAILURE_PERSISTENCE_WARNING}`,
        },
        {
            label: 'no-op execution',
            execution: { status: 'no-op' as const },
            outcome: 'no-op' as const,
            notification: `No project changes were needed. ${AGENT_RUN_COMPLETION_PERSISTENCE_WARNING}`,
        },
    ])(
        'does not write a terminal lifecycle state after persistence fails for $label',
        async ({ execution, outcome, notification }) => {
            const fixture = getBatchFixtures().stem;
            seedRun(fixture);
            mocks.executePlannedActions.mockResolvedValue(execution);
            vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
                throw new Error('Lease storage unavailable');
            });

            await expect(
                executePromptActionGroup({
                    actions: fixture.actions,
                    prompt: 'Import stems',
                    projectRevision: 'revision-1',
                    ...admitted(fixture),
                })
            ).resolves.toEqual({ status: outcome });

            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase: 'executing',
                batches: [{ batchId: BATCH_ID, status: 'executing', receiptIdentity: null }],
                workLeases: [{ workId: BATCH_ID, terminalState: null }],
            });
            expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(notification, []);
        }
    );

    it.each([
        {
            label: 'invalidated stale settlement',
            execution: { status: 'invalidated' as const, reason: 'Revision changed' },
            settle: () => ({ status: 'stale' as const }),
            warning: AGENT_RUN_STALE_FAILURE_WARNING,
        },
        {
            label: 'failed stale settlement',
            execution: { status: 'failed' as const, reason: 'Execution failed' },
            settle: () => ({ status: 'stale' as const }),
            warning: AGENT_RUN_STALE_FAILURE_WARNING,
        },
        {
            label: 'invalidated persistence failure',
            execution: { status: 'invalidated' as const, reason: 'Revision changed' },
            settle: () => {
                throw new Error('Lease storage unavailable');
            },
            warning: AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
        },
        {
            label: 'failed persistence failure',
            execution: { status: 'failed' as const, reason: 'Execution failed' },
            settle: () => {
                throw new Error('Lease storage unavailable');
            },
            warning: AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
        },
    ])('does not terminalize $label', async ({ execution, settle, warning }) => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue(execution);
        vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(settle);

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'failed' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'executing',
            batches: [{ batchId: BATCH_ID, status: 'executing', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            `Command not executed: ${execution.reason}. ${warning}`,
            []
        );
    });

    it.each(['lease-settlement', 'receipt-persistence'] as const)(
        'keeps a verified committed receipt authoritative when %s throws',
        async (failurePoint) => {
            const fixture = getBatchFixtures().stem;
            seedRun(fixture);
            mocks.executePlannedActions.mockResolvedValue({
                status: 'committed',
                actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
                receipt: committedReceipt(fixture),
            });
            if (failurePoint === 'lease-settlement') {
                vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
                    throw new Error('Lease persistence unavailable');
                });
            } else {
                vi.spyOn(receiptSaga, 'recordAgentRunReceiptSaga').mockImplementationOnce(() => {
                    throw new Error('Receipt persistence unavailable');
                });
            }

            await expect(
                executePromptActionGroup({
                    actions: fixture.actions,
                    prompt: 'Import stems',
                    projectRevision: 'revision-1',
                    ...admitted(fixture),
                })
            ).resolves.toEqual({ status: 'committed' });

            expect(mocks.notifyAiChange).toHaveBeenCalledWith(
                expect.stringMatching(/project change committed.*do not retry automatically/i),
                ['importStemSet']
            );
            expect(mocks.notifyAiChange).not.toHaveBeenCalledWith(
                expect.stringMatching(/command not executed/i),
                expect.anything()
            );
            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase: failurePoint === 'lease-settlement' ? 'partially-completed' : 'completed',
                batches: [
                    {
                        batchId: BATCH_ID,
                        status: 'committed',
                        receiptIdentity: '2:prompt-run-1:batch-1:committed',
                    },
                ],
                workLeases: [
                    {
                        workId: BATCH_ID,
                        terminalState: failurePoint === 'lease-settlement' ? null : 'completed',
                    },
                ],
            });
        }
    );

    it('keeps a committed receipt authoritative when lease settlement returns stale', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
            receipt: committedReceipt(fixture),
        });
        vi.spyOn(agentRunWorkLease, 'settle').mockReturnValueOnce({ status: 'stale' });

        await expect(
            executePromptActionGroup({
                actions: fixture.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            batches: [
                {
                    batchId: BATCH_ID,
                    status: 'committed',
                    receiptIdentity: '2:prompt-run-1:batch-1:committed',
                },
            ],
            workLeases: [{ workId: BATCH_ID, terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            expect.stringMatching(/project change committed.*cancelled or replaced.*do not retry automatically/i),
            ['importStemSet']
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalledWith(
            expect.stringMatching(/command not executed/i),
            expect.anything()
        );
    });

    it('rejects a prepared batch whose persisted run identity differs from the admitted run', async () => {
        const fixtures = getBatchFixtures();
        seedRun(fixtures.stem);

        await expect(
            executePromptActionGroup({
                actions: fixtures.differentRun.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixtures.differentRun),
            })
        ).rejects.toThrow('does not belong to admitted run');

        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
            workLeases: [],
        });
    });

    it('fails the admitted tracked batch when a prepared envelope supplies a different batch id', async () => {
        const fixtures = getBatchFixtures();
        seedRun(fixtures.stem);

        await expect(
            executePromptActionGroup({
                actions: fixtures.differentBatch.actions,
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(fixtures.differentBatch),
            })
        ).rejects.toThrow('does not belong to admitted run');

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
        });
        expect(mocks.discardPreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
    });

    it('terminalizes actions rejected by the approved command boundary', async () => {
        const fixture = getBatchFixtures().stem;
        seedRun(fixture);

        await expect(
            executePromptActionGroup({
                actions: [{ type: 'removeAllTracks' }],
                prompt: 'Delete everything',
                projectRevision: 'revision-1',
                ...admitted(fixture),
            })
        ).resolves.toEqual({ status: 'failed' });

        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
            workLeases: [],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
    });
});
