import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { admitCommittedSectionRenderRetry } from '../admitCommittedSectionRenderRetry';

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));

vi.mock('../../agentRunLifecycle', () => ({ agentRunLifecycle: { get: mocks.getRun } }));

const RUN_ID = 'run-render-retry';
const BATCH_ID = 'batch-render-retry';
const PROJECT_REVISION = 'revision-proposed';
const COMMITTED_REVISION = 'revision-committed';

function createFixture(): {
    commandBatch: NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
    confirmation: PendingAppActionConfirmation;
    receipt: ReturnType<typeof createVerifiedBatchReceipt>;
} {
    const action = {
        type: 'renderProjectSections',
        payload: {
            sectionIds: ['section-verse'],
            jobs: [
                {
                    jobId: 'render-verse',
                    sectionId: 'section-verse',
                    sectionName: 'Verse',
                    startBeat: 0,
                    endBeat: 16,
                    sampleRate: 44_100,
                    tailSeconds: 0,
                },
            ],
        },
    } satisfies AppAction;
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        expectedEffect: 'Render Verse.',
        normalizedProjectRevision: PROJECT_REVISION,
        options: { groupId: BATCH_ID, source: 'prompt' },
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: RUN_ID,
        batchId: BATCH_ID,
        projectId: 'project-render-retry',
        baseRevision: PROJECT_REVISION,
        intent: 'Render Verse',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const receipt = createVerifiedBatchReceipt({
        contentHash: 'content-render-retry',
        envelope: parsed.envelope,
        observedBaseRevision: PROJECT_REVISION,
        resultingRevision: null,
        result: {
            status: 'committed-with-warning',
            actions: [
                {
                    action,
                    receipt: {
                        commandId: command.commandId,
                        schemaVersion: command.schemaVersion,
                        applicationAssigned: { ids: [], timestamps: [] },
                    },
                },
            ],
            warning: 'Section rendering remains incomplete.',
            warningDetails: [
                {
                    kind: 'external-effect',
                    message: 'Renderer unavailable.',
                    commandId: command.commandId,
                    pendingEffect: {
                        commandId: command.commandId,
                        operation: 'renderProjectSections',
                        reason: 'Renderer unavailable.',
                        state: 'pending',
                        kind: 'external-effect',
                        remediation: 'reconcile',
                    },
                },
            ],
        },
    });
    const confirmation = {
        id: 'confirmation-render-retry',
        runId: RUN_ID,
        prompt: 'Render Verse',
        assistantMessageId: 'assistant-render-retry',
        actionLabels: ['Render Verse'],
        affectedIds: ['section-verse', 'render-verse'],
        protectedUnchanged: [],
        risk: { level: 'external-effect', reason: 'Renders an audio file.' },
        executedActions: [
            {
                actionType: 'renderProjectSections',
                commandId: command.commandId,
                commandSchemaVersion: command.schemaVersion,
                label: 'Render Verse',
                executionKind: 'project',
                affectedIds: ['section-verse'],
                outcome: 'committed-with-warning',
            },
        ],
        status: 'failed',
        error: 'Renderer unavailable.',
        followUpProjectRevision: COMMITTED_REVISION,
        followUpStatus: 'retryable',
        createdAt: 1,
        resolvedAt: 2,
        kind: 'app_actions',
        projectRevision: PROJECT_REVISION,
        actions: [action],
        approvalSnapshot: {
            actions: [action],
            actionLabels: ['Render Verse'],
            commandEnvelopes: [serializeVersionedCommandEnvelope(command)],
            commandBatch,
            protectedUnchanged: [],
        },
        executionMode: 'atomic',
        groupId: BATCH_ID,
        groupLabel: 'Render Verse',
    } satisfies PendingAppActionConfirmation;
    return { commandBatch, confirmation, receipt };
}

function bindTrackedRun(input: ReturnType<typeof createFixture>): void {
    const receiptIdentity = `${String(input.receipt.schemaVersion)}:${RUN_ID}:${BATCH_ID}:${input.receipt.outcome}`;
    mocks.getRun.mockReturnValue({
        revisions: { committed: COMMITTED_REVISION },
        receipts: [{ workId: BATCH_ID, receiptIdentity }],
        pendingEffectContinuations: [
            {
                batchId: BATCH_ID,
                receiptIdentity,
                recovery: 'reconcile-batch',
                serializedBatch: input.commandBatch.serialized,
                authority: input.commandBatch.authority,
                effects: structuredClone(input.receipt.pendingEffects),
            },
        ],
    });
}

describe('admitCommittedSectionRenderRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
    });

    it('arms canonical evidence without a tracked run but requires that run for retry proof', () => {
        const fixture = createFixture();
        mocks.getRun.mockReturnValue(undefined);

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                phase: 'arming',
            })
        ).toEqual({ durableReceipt: fixture.receipt, status: 'admitted' });
        expect(mocks.getRun).not.toHaveBeenCalled();

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
        expect(mocks.getRun).toHaveBeenCalledOnce();

        bindTrackedRun(fixture);
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ durableReceipt: fixture.receipt, status: 'admitted' });
    });

    it('rejects manual-review evidence during arming and proof', () => {
        const fixture = createFixture();
        const pendingEffect = fixture.receipt.pendingEffects[0];
        if (!pendingEffect || pendingEffect.kind !== 'external-effect') {
            throw new Error('Expected external render pending effect');
        }
        pendingEffect.remediation = 'manual-repair';

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'proof-mismatch' });

        bindTrackedRun(fixture);
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it.each([
        [
            'non-terminal confirmation',
            (confirmation: PendingAppActionConfirmation) => (confirmation.status = 'proposed'),
        ],
        [
            'non-retryable follow-up',
            (confirmation: PendingAppActionConfirmation) => (confirmation.followUpStatus = 'failed'),
        ],
        [
            'missing committed revision',
            (confirmation: PendingAppActionConfirmation) => (confirmation.followUpProjectRevision = null),
        ],
    ])('rejects %s before requesting proof', (_name, mutate) => {
        const fixture = createFixture();
        mutate(fixture.confirmation);

        expect(admitCommittedSectionRenderRetry({ confirmation: fixture.confirmation, phase: 'eligibility' })).toEqual({
            status: 'ineligible',
        });
        expect(mocks.getRun).not.toHaveBeenCalled();
    });

    it('rejects changed serialized identity or canonical authority as stale', () => {
        const fixture = createFixture();
        const changedSerialized = structuredClone(fixture.confirmation);
        if (!changedSerialized.approvalSnapshot.commandBatch) {
            throw new Error('Expected command batch');
        }
        changedSerialized.approvalSnapshot.commandBatch.serialized += ' ';
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: changedSerialized,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'eligibility',
            })
        ).toEqual({ status: 'stale' });

        const changedAuthority = structuredClone(fixture.confirmation);
        if (!changedAuthority.approvalSnapshot.commandBatch) {
            throw new Error('Expected command batch');
        }
        changedAuthority.approvalSnapshot.commandBatch.authority.budgets.maxRenderJobs += 1;
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: changedAuthority,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'eligibility',
            })
        ).toEqual({ status: 'stale' });
    });

    it.each([
        [
            'command identity',
            (fixture: ReturnType<typeof createFixture>) =>
                (fixture.confirmation.executedActions[0]!.commandId = 'wrong-command'),
        ],
        [
            'command operation',
            (fixture: ReturnType<typeof createFixture>) =>
                (fixture.confirmation.executedActions[0]!.actionType = 'setTempo'),
        ],
        [
            'command schema',
            (fixture: ReturnType<typeof createFixture>) =>
                (fixture.confirmation.executedActions[0]!.commandSchemaVersion = 99),
        ],
        [
            'execution kind',
            (fixture: ReturnType<typeof createFixture>) =>
                (fixture.confirmation.executedActions[0]!.executionKind = 'runtime'),
        ],
        [
            'execution outcome',
            (fixture: ReturnType<typeof createFixture>) => (fixture.confirmation.executedActions = []),
        ],
        [
            'render payload',
            (fixture: ReturnType<typeof createFixture>) => {
                const renderAction = fixture.confirmation.approvalSnapshot.actions[0];
                if (!renderAction || renderAction.type !== 'renderProjectSections') {
                    throw new Error('Expected render action');
                }
                renderAction.payload.sectionIds = ['section-chorus'];
            },
        ],
        [
            'durable pending effect state',
            (fixture: ReturnType<typeof createFixture>) => {
                const pendingEffect = fixture.receipt.pendingEffects[0];
                if (!pendingEffect) {
                    throw new Error('Expected durable pending effect');
                }
                Reflect.set(pendingEffect, 'state', 'completed');
            },
        ],
        [
            'top-level receipt outcome',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.receipt.outcome = 'committed';
                bindTrackedRun(fixture);
            },
        ],
        ['receipt atomicity', (fixture: ReturnType<typeof createFixture>) => (fixture.receipt.atomicity = 'atomic')],
        [
            'durable receipt command binding',
            (fixture: ReturnType<typeof createFixture>) =>
                (fixture.receipt.pendingEffects[0]!.commandId = 'wrong-command'),
        ],
        [
            'durable batch identity',
            (fixture: ReturnType<typeof createFixture>) => (fixture.receipt.batchId = 'wrong-batch'),
        ],
    ])('rejects mismatched %s proof', (_name, mutate) => {
        const fixture = createFixture();
        bindTrackedRun(fixture);
        mutate(fixture);

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it('rejects missing durable proof', () => {
        const fixture = createFixture();
        bindTrackedRun(fixture);

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: null,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it('admits an exact live finalized continuation settlement without replay proof', () => {
        const fixture = createFixture();
        const finalizedReceipt = structuredClone(fixture.receipt);
        finalizedReceipt.outcome = 'committed';
        finalizedReceipt.atomicity = 'atomic';
        finalizedReceipt.pendingEffects = [];
        const renderCommandId = fixture.receipt.commandOutcomes[0]!.commandId;
        const receiptIdentity = `${String(finalizedReceipt.schemaVersion)}:${RUN_ID}:${BATCH_ID}:committed`;
        mocks.getRun.mockReturnValue({
            revisions: { committed: COMMITTED_REVISION },
            receipts: [{ workId: BATCH_ID, receiptIdentity }],
            committedWork: [{ workId: BATCH_ID, receiptIdentity }],
            batches: [{ batchId: BATCH_ID, status: 'committed', receiptIdentity }],
            pendingEffectContinuations: [],
            saga: {
                steps: [
                    {
                        stepId: `effect:${BATCH_ID}:${renderCommandId}`,
                        owner: 'external-effect',
                        workId: BATCH_ID,
                        state: 'committed',
                        receiptIdentity,
                    },
                ],
            },
        });

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: finalizedReceipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ durableReceipt: finalizedReceipt, status: 'admitted' });

        finalizedReceipt.atomicity = 'durable-atomic-with-non-atomic-effects';
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: finalizedReceipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });

        finalizedReceipt.atomicity = 'atomic';
        const trackedRun = mocks.getRun();
        trackedRun.saga.steps[0]!.stepId = `effect:${BATCH_ID}:unrelated-command`;
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: finalizedReceipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it.each([
        [
            'malformed serialized batch',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.confirmation.approvalSnapshot.commandBatch!.serialized = '{not-json';
            },
        ],
        [
            'invalid authority',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.confirmation.approvalSnapshot.commandBatch!.authority.budgets.maxRenderJobs = -1;
            },
        ],
    ])('rejects %s during arming and proof', (_name, mutate) => {
        const fixture = createFixture();
        mutate(fixture);

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'proof-mismatch' });
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it('rejects an otherwise exact receipt carrying a second pending effect', () => {
        const fixture = createFixture();
        const renderPendingEffect = fixture.receipt.pendingEffects[0];
        if (!renderPendingEffect) {
            throw new Error('Expected render pending effect');
        }
        const receipt = {
            ...fixture.receipt,
            pendingEffects: [
                renderPendingEffect,
                {
                    ...renderPendingEffect,
                    commandId: 'unrelated-pending-effect',
                    reason: 'An unrelated external effect remains pending.',
                },
            ],
        } satisfies ReturnType<typeof createVerifiedBatchReceipt>;

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'proof-mismatch' });

        bindTrackedRun(fixture);
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it('rejects duplicate approved render actions', () => {
        const fixture = createFixture();
        const renderAction = fixture.confirmation.approvalSnapshot.actions[0];
        if (!renderAction || renderAction.type !== 'renderProjectSections') {
            throw new Error('Expected render action');
        }
        fixture.confirmation.approvalSnapshot.actions.push(structuredClone(renderAction));

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it('rejects ambiguous cardinality from two approved render actions and commands', () => {
        const fixture = createFixture();
        const secondAction = {
            type: 'renderProjectSections',
            payload: {
                sectionIds: ['section-chorus'],
                jobs: [
                    {
                        jobId: 'render-chorus',
                        sectionId: 'section-chorus',
                        sectionName: 'Chorus',
                        startBeat: 16,
                        endBeat: 32,
                        sampleRate: 44_100,
                        tailSeconds: 0,
                    },
                ],
            },
        } satisfies AppAction;
        const secondCommand = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: secondAction,
            expectedEffect: 'Render Chorus.',
            normalizedProjectRevision: PROJECT_REVISION,
            options: { groupId: BATCH_ID, source: 'prompt' },
        });
        const firstSerializedCommand = fixture.confirmation.approvalSnapshot.commandEnvelopes?.[0];
        if (!firstSerializedCommand) {
            throw new Error('Expected first command');
        }
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: RUN_ID,
            batchId: BATCH_ID,
            projectId: 'project-render-retry',
            baseRevision: PROJECT_REVISION,
            intent: 'Render Verse and Chorus',
            commands: [firstSerializedCommand, serializeVersionedCommandEnvelope(secondCommand)],
        });
        fixture.confirmation.approvalSnapshot.commandBatch = commandBatch;
        fixture.confirmation.approvalSnapshot.commandEnvelopes = [
            firstSerializedCommand,
            serializeVersionedCommandEnvelope(secondCommand),
        ];
        fixture.confirmation.actions.push(secondAction);
        fixture.confirmation.approvalSnapshot.actions.push(secondAction);
        fixture.confirmation.executedActions.push({
            actionType: 'renderProjectSections',
            commandId: secondCommand.commandId,
            commandSchemaVersion: secondCommand.schemaVersion,
            label: 'Render Chorus',
            executionKind: 'project',
            affectedIds: ['section-chorus'],
            outcome: 'committed',
        });

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'proof-mismatch' });

        fixture.commandBatch = commandBatch;
        bindTrackedRun(fixture);
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });

    it.each([
        ['missing run', () => mocks.getRun.mockReturnValue(undefined)],
        [
            'stale committed revision',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({ ...mocks.getRun(), revisions: { committed: 'stale-revision' } });
            },
        ],
        [
            'missing receipt binding',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({ ...mocks.getRun(), receipts: [] });
            },
        ],
        [
            'stale continuation proof',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    pendingEffectContinuations: [
                        { ...mocks.getRun().pendingEffectContinuations[0], serializedBatch: 'stale-batch' },
                    ],
                });
            },
        ],
        [
            'manual-repair continuation',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    pendingEffectContinuations: [
                        { ...mocks.getRun().pendingEffectContinuations[0], recovery: 'manual-repair' },
                    ],
                });
            },
        ],
        [
            'extra continuation effect',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    pendingEffectContinuations: [
                        {
                            ...mocks.getRun().pendingEffectContinuations[0],
                            effects: [
                                ...mocks.getRun().pendingEffectContinuations[0].effects,
                                { ...fixture.receipt.pendingEffects[0]!, commandId: 'extra-render-command' },
                            ],
                        },
                    ],
                });
            },
        ],
        [
            'missing continuation effect',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    pendingEffectContinuations: [{ ...mocks.getRun().pendingEffectContinuations[0], effects: [] }],
                });
            },
        ],
        [
            'mismatched continuation effect',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    pendingEffectContinuations: [
                        {
                            ...mocks.getRun().pendingEffectContinuations[0],
                            effects: [{ ...fixture.receipt.pendingEffects[0]!, commandId: 'wrong-render-command' }],
                        },
                    ],
                });
            },
        ],
        [
            'wrong tracked receipt identity',
            (fixture: ReturnType<typeof createFixture>) => {
                bindTrackedRun(fixture);
                mocks.getRun.mockReturnValue({
                    ...mocks.getRun(),
                    receipts: [{ workId: BATCH_ID, receiptIdentity: 'wrong-receipt' }],
                });
            },
        ],
    ])('rejects %s', (_name, arrange) => {
        const fixture = createFixture();
        arrange(fixture);

        expect(
            admitCommittedSectionRenderRetry({
                confirmation: fixture.confirmation,
                durableReceipt: fixture.receipt,
                expectedCommandBatch: fixture.commandBatch,
                phase: 'proof',
            })
        ).toEqual({ status: 'proof-mismatch' });
    });
});
