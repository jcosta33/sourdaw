import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunExecutionSettlement } from '../agentRunExecutionSettlement';
import { AGENT_RUN_PERSISTENCE_WARNING } from '../settleAgentRunWorkLeaseSafely';

const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies AppAction;

function createConfirmation(): PendingAppActionConfirmation {
    const command = createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Tempo changes to 132 BPM.',
        normalizedProjectRevision: 'revision-1',
        objectReferences: [],
        parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
        reason: 'Apply the confirmed tempo change.',
        time: [],
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: 'Set tempo to 132 BPM.',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    return {
        id: 'confirmation-1',
        runId: 'run-1',
        prompt: 'Set tempo to 132 BPM.',
        assistantMessageId: 'assistant-1',
        actions: [action],
        actionLabels: ['Set tempo to 132 BPM'],
        affectedIds: [],
        protectedUnchanged: [],
        risk: null,
        executedActions: [],
        status: 'accepted',
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: 0,
        resolvedAt: null,
        kind: 'app_actions',
        projectRevision: 'revision-1',
        approvalSnapshot: {
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            protectedUnchanged: [],
        },
        executionMode: 'atomic',
    };
}

describe('agentRunExecutionSettlement', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('terminalizes post-commit recovery failure without rewriting the committed batch', () => {
        const confirmation = createConfirmation();
        const receiptIdentity = '1:run-1:batch-1:committed';
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'planning',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: {
                batchId: 'batch-1',
                commandIds: [],
                status: 'executing',
                receiptIdentity: null,
            },
        });
        agentRunLifecycle.recordCommittedWork({
            runId: confirmation.runId,
            workId: 'batch-1',
            receiptIdentity,
            completesRun: false,
        });

        agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receiptIdentity,
        });

        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            batches: [{ batchId: 'batch-1', status: 'committed', receiptIdentity }],
            committedWork: [{ workId: 'batch-1', receiptIdentity }],
            errors: [
                expect.objectContaining({
                    category: 'internal',
                    workId: null,
                    related: expect.objectContaining({
                        receiptIdentities: [receiptIdentity],
                        workIds: [],
                    }),
                }),
            ],
        });
    });

    it('returns a persistence warning when terminal recovery settlement cannot be saved', () => {
        const confirmation = createConfirmation();
        const receiptIdentity = '1:run-1:batch-1:committed';
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'planning',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });
        agentRunLifecycle.recordCommittedWork({
            runId: confirmation.runId,
            workId: 'batch-1',
            receiptIdentity,
            completesRun: false,
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        try {
            expect(
                agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
                    category: 'internal',
                    retriable: false,
                    receiptIdentity,
                })
            ).toBe(AGENT_RUN_PERSISTENCE_WARNING);
        } finally {
            setItem.mockRestore();
        }
    });
});
