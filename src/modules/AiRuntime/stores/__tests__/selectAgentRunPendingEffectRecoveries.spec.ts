import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { readAgentRunState } from '../agentRunStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
    recordPendingActionExecution,
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../pendingActionConfirmationStore';
import { selectAgentRunPendingEffectRecoveries } from '../selectAgentRunPendingEffectRecoveries';

const RUN_ID = 'run-render-owner';
const BATCH_ID = 'batch-render-owner';
const COMMAND_ID = 'command-render-owner';
const COMMITTED_REVISION = 'revision-render-committed';

function createRetainedRenderRecovery() {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Render the retained section.',
        mode: 'macro',
        createdRevision: 'revision-render-created',
        createdAt: 1,
    });
    const authority = {
        projectId: 'project-render-owner',
        baseRevision: 'revision-render-created',
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: ['renderProjectSections'],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: true,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: true,
        },
        budgets: {
            maxCommands: 1,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 0,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 1,
        },
    };
    const receiptIdentity = `2:${RUN_ID}:${BATCH_ID}:partially-committed`;
    agentRunLifecycle.recordCommittedWork({
        runId: RUN_ID,
        workId: BATCH_ID,
        receiptIdentity,
        committedRevision: COMMITTED_REVISION,
        completesRun: false,
        committedAt: 2,
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: RUN_ID,
        continuation: {
            authority,
            batchId: BATCH_ID,
            effects: [
                {
                    commandId: COMMAND_ID,
                    kind: 'external-effect',
                    operation: 'renderProjectSections',
                    reason: 'renderer unavailable',
                    remediation: 'reconcile',
                    state: 'pending',
                },
            ],
            lastError: null,
            receiptIdentity,
            recovery: 'reconcile-batch',
            serializedBatch: '{"batch":"render-owner"}',
        },
        recordedAt: 3,
    });
    return authority;
}

function createRetryableConfirmation(input: {
    authority: ReturnType<typeof createRetainedRenderRecovery>;
    followUpRevision: string;
    outcome?: 'committed' | 'committed-with-warning' | 'executed';
}): void {
    proposePendingActionConfirmation({
        id: 'confirmation-render-owner',
        runId: RUN_ID,
        prompt: 'Retry the retained section render.',
        assistantMessageId: 'assistant-render-owner',
        actions: [{ type: 'renderProjectSections', payload: { jobs: [], sectionIds: [] } }],
        actionLabels: ['Render section'],
        executionMode: 'atomic',
        projectRevision: 'revision-render-created',
        groupId: BATCH_ID,
        commandBatch: { authority: input.authority, serialized: '{"batch":"render-owner"}' },
    });
    updatePendingActionConfirmationStatus({ confirmationId: 'confirmation-render-owner', status: 'executed' });
    recordPendingActionExecution({
        confirmationId: 'confirmation-render-owner',
        execution: {
            actionType: 'renderProjectSections',
            commandId: COMMAND_ID,
            label: 'Render section',
            executionKind: 'project',
            affectedIds: ['section-render-owner'],
            outcome: input.outcome ?? 'committed-with-warning',
        },
    });
    updatePendingActionFollowUp({
        confirmationId: 'confirmation-render-owner',
        projectRevision: input.followUpRevision,
        status: 'retryable',
    });
}

describe('selectAgentRunPendingEffectRecoveries', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
    });

    afterEach(() => {
        clearPendingActionConfirmations();
    });

    it('hides only the exact retryable confirmation owner', () => {
        const authority = createRetainedRenderRecovery();
        createRetryableConfirmation({ authority, followUpRevision: COMMITTED_REVISION });

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([]);
    });

    it('keeps an escalated manual-repair recovery visible to the confirmation owner that would otherwise hide it', () => {
        const authority = createRetainedRenderRecovery();
        createRetryableConfirmation({ authority, followUpRevision: COMMITTED_REVISION });

        // The owner hides this batch while its effects are reconcilable, so the
        // escalation below is the only thing that changes. A manual-repair effect
        // names work the user has to do, and no live retry claim may take it off
        // the panel.
        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([]);

        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: RUN_ID,
            batchId: BATCH_ID,
            reason: 'The retained render cannot be retried exactly.',
            requiredAt: 4,
        });

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({
                runId: RUN_ID,
                batchId: BATCH_ID,
                recovery: 'manual-repair',
                effects: [expect.objectContaining({ commandId: COMMAND_ID, remediation: 'manual-repair' })],
            }),
        ]);
    });

    it('keeps generic recovery visible when the confirmation authority is tampered', () => {
        const authority = createRetainedRenderRecovery();
        createRetryableConfirmation({
            authority: { ...authority, budgets: { ...authority.budgets, maxRenderJobs: 2 } },
            followUpRevision: COMMITTED_REVISION,
        });

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({ runId: RUN_ID, batchId: BATCH_ID, recovery: 'manual-repair' }),
        ]);
    });

    it('keeps generic recovery visible when the follow-up revision does not own the committed run revision', () => {
        const authority = createRetainedRenderRecovery();
        createRetryableConfirmation({ authority, followUpRevision: 'revision-render-foreign' });

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({ runId: RUN_ID, batchId: BATCH_ID, recovery: 'manual-repair' }),
        ]);
    });

    it.each(['committed', 'executed'] as const)(
        'keeps generic recovery visible when the render outcome is %s',
        (outcome) => {
            const authority = createRetainedRenderRecovery();
            createRetryableConfirmation({ authority, followUpRevision: COMMITTED_REVISION, outcome });

            expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
                expect.objectContaining({ runId: RUN_ID, batchId: BATCH_ID, recovery: 'manual-repair' }),
            ]);
        }
    );
});
