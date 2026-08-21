import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { executePromptActionGroup } from '../executePromptActionGroup';
import * as receiptSaga from '../recordAgentRunReceiptSaga';

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-2' },
    executePlannedActions: vi.fn(),
    notifyAiChange: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    issueApprovalBinding: vi.fn(() => ({ token: 'exact-approval' })),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    generateGroupId: () => ({ groupId: 'group-1', groupLabel: 'Prompt action' }),
    isExecutableAppActionType: (type: string) => type !== 'removeAllTracks',
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));
vi.mock('../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));

const RUN_ID = 'prompt-run-1';
const BATCH_ID = 'batch-1';
const IDEMPOTENCY_KEY = 'batch-key-1';
const action = { type: 'togglePlayback' } satisfies AppAction;
const commandBatch = { serialized: 'command-batch', authority: { projectId: 'revision-1' } } as never;

const scope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const grants = {
    allowedOperationPrefixes: ['togglePlayback'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};

function seedRun(phase: 'planning' | 'waiting-for-approval' = 'planning'): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Play',
        mode: 'apply',
        createdRevision: 'revision-1',
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning', revision: 'revision-1' });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Toggle playback',
        commandIds: ['command-1'],
        serializedBatchIdentity: IDEMPOTENCY_KEY,
        revision: 'revision-1',
        scope,
        grants,
        budgets: { limits: {}, consumed: {} },
        recordedAt: 101,
    });
    agentRunLifecycle.recordBatch({
        runId: RUN_ID,
        batch: {
            batchId: BATCH_ID,
            commandIds: ['command-1'],
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

function admitted(agentApproval: unknown = null) {
    return {
        runId: RUN_ID,
        prepared: {
            commandBatch,
            agentApproval: agentApproval as never,
            requiresConfirmation: agentApproval !== null,
        },
    };
}

function verifiedReceipt(
    outcome: 'committed' | 'executed' = 'committed',
    identity: { runId?: string; batchId?: string } = {}
) {
    return {
        schemaVersion: 1,
        runId: identity.runId ?? RUN_ID,
        batchId: identity.batchId ?? BATCH_ID,
        outcome,
        links: { render: [], analysis: [] },
    } as never;
}

describe('executePromptActionGroup', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        agentRunLifecycle.clear();
        mocks.projectRevision.value = 'revision-2';
        mocks.issueApprovalBinding.mockReturnValue({ token: 'exact-approval' });
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: RUN_ID,
                batchId: BATCH_ID,
                idempotencyKey: IDEMPOTENCY_KEY,
                commands: [{ commandId: 'command-1' }],
            },
        });
    });

    it('binds the exact application-issued approval to the admitted command batch', async () => {
        const approval = { actorId: 'artist-1', fingerprint: 'compiled-risk-fingerprint' };
        seedRun('waiting-for-approval');
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [],
            receipt: verifiedReceipt(),
        });

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            ...admitted(approval),
        });

        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({ approval, commandBatch });
        expect(mocks.executePlannedActions).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: RUN_ID,
                commandBatch: expect.objectContaining({ approvalBinding: { token: 'exact-approval' } }),
            })
        );
    });

    it.each([
        {
            result: { status: 'committed', actions: [], receipt: verifiedReceipt('committed') },
            phase: 'completed',
            committedRevision: 'revision-2',
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '1:prompt-run-1:batch-1:committed',
            notification: null,
        },
        {
            result: { status: 'executed', actions: [], receipt: verifiedReceipt('executed') },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '1:prompt-run-1:batch-1:executed',
            notification: null,
        },
        {
            result: { status: 'invalidated', reason: 'Revision changed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command not executed: Revision changed', []],
        },
        {
            result: { status: 'failed', reason: 'Execution failed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command not executed: Execution failed', []],
        },
        {
            result: { status: 'ambiguous', reason: 'Receipt missing' },
            phase: 'partially-completed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command outcome is uncertain: Receipt missing. Inspect the project before retrying.', []],
        },
        {
            result: { status: 'cancelled' },
            phase: 'cancelled',
            committedRevision: null,
            batchStatus: 'cancelled',
            leaseState: 'cancelled',
            receiptIdentity: null,
            notification: ['Command cancelled before it committed. No project changes were applied.', []],
        },
        {
            result: { status: 'no-op' },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'no-op',
            leaseState: 'completed',
            receiptIdentity: null,
            notification: ['No project changes were needed.', []],
        },
    ])(
        'reconciles $result.status to exact run, batch, lease, receipt, and notification truth',
        async ({ result, phase, committedRevision, batchStatus, leaseState, receiptIdentity, notification }) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue(result);

            await expect(
                executePromptActionGroup({
                    actions: [action],
                    prompt: 'Play',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status: result.status === 'invalidated' ? 'failed' : result.status });

            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase,
                revisions: { committed: committedRevision },
                batches: [{ batchId: BATCH_ID, status: batchStatus, receiptIdentity }],
                workLeases: [
                    {
                        runId: RUN_ID,
                        workId: BATCH_ID,
                        idempotencyKey: IDEMPOTENCY_KEY,
                        terminalState: leaseState,
                    },
                ],
            });
            if (notification === null) {
                expect(mocks.notifyAiChange).not.toHaveBeenCalled();
            } else {
                expect(mocks.notifyAiChange).toHaveBeenCalledWith(...(notification as [string, []]));
            }
        }
    );

    it.each([
        {
            label: 'missing',
            receipt: undefined,
            warning:
                'Command outcome is uncertain: Command execution completed without an exact verified receipt. Inspect the project before retrying.',
        },
        {
            label: 'different-run',
            receipt: verifiedReceipt('committed', { runId: 'different-run' }),
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
        {
            label: 'different-batch',
            receipt: verifiedReceipt('committed', { batchId: 'different-batch' }),
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
    ])('keeps a $label committed receipt outcome uncertain', async ({ receipt, warning }) => {
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({ status: 'committed', actions: [], receipt });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
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
    });

    it('reconciles a thrown execution before propagating the failure', async () => {
        seedRun();
        mocks.executePlannedActions.mockRejectedValue(new Error('Executor crashed'));

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).rejects.toThrow('Executor crashed');

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: 'failed' }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Command not executed: Executor crashed', []);
    });

    it.each(['lease-settlement', 'receipt-persistence'] as const)(
        'keeps a verified committed receipt authoritative when %s throws',
        async (failurePoint) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue({
                status: 'committed',
                actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
                receipt: verifiedReceipt(),
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
                    actions: [action],
                    prompt: 'Play',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status: 'committed' });

            expect(mocks.notifyAiChange).toHaveBeenCalledWith(
                expect.stringMatching(/project change committed.*do not retry automatically/i),
                ['togglePlayback']
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
                        receiptIdentity: '1:prompt-run-1:batch-1:committed',
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
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt: verifiedReceipt(),
        });
        vi.spyOn(agentRunWorkLease, 'settle').mockReturnValueOnce({ status: 'stale' });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            batches: [
                {
                    batchId: BATCH_ID,
                    status: 'committed',
                    receiptIdentity: '1:prompt-run-1:batch-1:committed',
                },
            ],
            workLeases: [{ workId: BATCH_ID, terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            expect.stringMatching(/project change committed.*cancelled or replaced.*do not retry automatically/i),
            ['togglePlayback']
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalledWith(
            expect.stringMatching(/command not executed/i),
            expect.anything()
        );
    });

    it('rejects a prepared batch whose persisted run identity differs from the admitted run', async () => {
        seedRun();
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: 'different-run',
                batchId: BATCH_ID,
                idempotencyKey: IDEMPOTENCY_KEY,
                commands: [{ commandId: 'command-1' }],
            },
        });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).rejects.toThrow('does not belong to admitted run');

        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
            workLeases: [],
        });
    });

    it('terminalizes actions rejected by the approved command boundary', async () => {
        seedRun();

        await expect(
            executePromptActionGroup({
                actions: [{ type: 'removeAllTracks' }],
                prompt: 'Delete everything',
                projectRevision: 'revision-1',
                ...admitted(),
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
