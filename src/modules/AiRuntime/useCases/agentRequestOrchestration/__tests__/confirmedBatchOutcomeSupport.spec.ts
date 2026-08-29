import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunExecutionSettlement } from '../agentRunExecutionSettlement';
import { confirmedBatchOutcomeSupport } from '../confirmedBatchOutcomeSupport';
import { AGENT_RUN_PERSISTENCE_WARNING } from '../settleAgentRunWorkLeaseSafely';

const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies AppAction;

function createConfirmationAndReceipt() {
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
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const receipt = createVerifiedBatchReceipt({
        contentHash: 'receipt-1',
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: { status: 'committed', actions: [] },
    });
    const confirmation = {
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
    } satisfies PendingAppActionConfirmation;
    return { confirmation, receipt };
}

function createExecutingRun(confirmation: PendingAppActionConfirmation): void {
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
}

describe('confirmedBatchOutcomeSupport', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('records committed work in live state after the first receipt persistence write fails', () => {
        const { confirmation, receipt } = createConfirmationAndReceipt();
        createExecutingRun(confirmation);
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        try {
            expect(
                confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(confirmation, receipt, {
                    committedRevision: 'revision-2',
                    completesRun: false,
                })
            ).toEqual({
                warning: AGENT_RUN_PERSISTENCE_WARNING,
                effectsPending: false,
            });
        } finally {
            setItem.mockRestore();
        }

        const receiptIdentity = confirmedBatchOutcomeSupport.getVerifiedReceiptIdentity(receipt);
        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'executing',
            committedWork: [{ workId: 'batch-1', receiptIdentity }],
            errors: [],
        });

        const recordError = vi.spyOn(agentRunLifecycle, 'recordError');
        agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receiptIdentity,
        });

        expect(recordError).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            committedWork: [{ workId: 'batch-1', receiptIdentity }],
            errors: [expect.objectContaining({ workId: null })],
        });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('partially-completed');
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain(receiptIdentity);
    });

    it('returns the persistence warning when atomic receipt recording rejects before recording work', () => {
        const { confirmation, receipt } = createConfirmationAndReceipt();
        createExecutingRun(confirmation);
        const recordReceiptSaga = vi.spyOn(agentRunLifecycle, 'recordReceiptSaga').mockImplementationOnce(() => {
            throw new Error('The receipt writer rejected the committed work.');
        });

        let receiptPersistence;
        try {
            receiptPersistence = confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(confirmation, receipt, {
                committedRevision: 'revision-2',
                completesRun: false,
            });
        } finally {
            recordReceiptSaga.mockRestore();
        }

        expect(receiptPersistence).toEqual({
            warning: AGENT_RUN_PERSISTENCE_WARNING,
            effectsPending: false,
        });
        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'executing',
            committedWork: [],
            errors: [],
        });
    });
});
