import { beforeEach, describe, expect, it } from 'vitest';

import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunControls } from '../getAgentRunControlProjection';

const {
    acknowledgeCancellation: acknowledgeAgentRunCancellation,
    cancel: cancelAgentRun,
    clear: clearAgentRuns,
    create: createAgentRun,
    get: getAgentRun,
    recordCommittedWork: recordAgentRunCommittedWork,
    recordError: recordAgentRunError,
    recordDecision: recordAgentRunDecision,
    requireManualResume: requireAgentRunManualResume,
} = agentRunLifecycle;
const { claim: claimAgentRunWorkLease, settle: settleAgentRunWorkLease } = agentRunWorkLease;
const { get: getAgentRunControlProjection } = agentRunControls;

describe('agent run control projection', () => {
    beforeEach(() => {
        clearAgentRuns();
    });

    it('exposes only truthful cancel, retry, resume, receipt, and revert controls', () => {
        createAgentRun({
            runId: 'run-controls',
            request: 'Render and analyze the chorus before applying it.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        recordAgentRunCommittedWork({
            runId: 'run-controls',
            workId: 'batch-1',
            receiptIdentity: 'receipt-1',
            revertGroupId: 'undo-group-1',
            completesRun: false,
            committedAt: 110,
        });
        claimAgentRunWorkLease({
            runId: 'run-controls',
            workId: 'analysis-1',
            ownerKind: 'analysis',
            cleanupOwner: 'analysis-worker',
            idempotencyKey: 'analysis-key',
            receiptIdentity: 'analysis-receipt',
            idempotent: true,
            retriable: true,
            claimedAt: 120,
        });
        settleAgentRunWorkLease({
            runId: 'run-controls',
            workId: 'analysis-1',
            leaseId: 'run-controls:analysis-1:0',
            cancellationGeneration: 0,
            idempotencyKey: 'analysis-key',
            receiptIdentity: 'analysis-receipt',
            terminalState: 'failed',
            settledAt: 130,
        });
        requireAgentRunManualResume({
            runId: 'run-controls',
            reason: 'Analysis failed after the project batch committed.',
            workIds: ['analysis-1'],
            requiredAt: 130,
        });

        const projection = getAgentRunControlProjection('run-controls');

        expect(projection).toEqual({
            runId: 'run-controls',
            schemaVersion: 1,
            mode: 'macro',
            phase: 'paused',
            request: 'Render and analyze the chorus before applying it.',
            cancellation: { requested: false, acknowledgement: 'none' },
            allowedActions: { cancel: true, resume: false, retryWorkIds: ['analysis-1'] },
            manualResumeReason: 'Analysis failed after the project batch committed.',
            resumeRejectionReason: 'The pending decision is unavailable or already consumed.',
            committedReceipts: [
                {
                    workId: 'batch-1',
                    receiptIdentity: 'receipt-1',
                    revertGroupId: 'undo-group-1',
                },
            ],
            errors: [],
        });
        expect(projection).not.toHaveProperty('workLeases');
        expect(projection).not.toHaveProperty('plan');
        expect(projection).not.toHaveProperty('grants');
    });

    it('revokes persisted retry eligibility when the terminal outcome forbids retry', () => {
        createAgentRun({
            runId: 'run-non-retriable',
            request: 'Apply the approved command.',
            mode: 'apply',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        claimAgentRunWorkLease({
            runId: 'run-non-retriable',
            workId: 'batch-1',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'batch-key',
            receiptIdentity: 'batch-receipt',
            idempotent: true,
            retriable: true,
            claimedAt: 110,
        });
        settleAgentRunWorkLease({
            runId: 'run-non-retriable',
            workId: 'batch-1',
            leaseId: 'run-non-retriable:batch-1:0',
            cancellationGeneration: 0,
            idempotencyKey: 'batch-key',
            receiptIdentity: 'batch-receipt',
            terminalState: 'failed',
            settledAt: 120,
        });
        recordAgentRunError({
            runId: 'run-non-retriable',
            error: {
                code: 'ambiguous-command-outcome',
                message: 'Do not retry this command.',
                occurredAt: 130,
                retriable: false,
                workId: 'batch-1',
            },
            terminal: true,
        });

        expect(getAgentRunControlProjection('run-non-retriable')).toMatchObject({
            phase: 'failed',
            allowedActions: { retryWorkIds: [] },
        });
        expect(getAgentRun('run-non-retriable')?.retriableWork).toEqual([]);
    });

    it('reports consumer, transport, and backend cancellation acknowledgement without claiming more', () => {
        createAgentRun({
            runId: 'run-cancel',
            request: 'Analyze the master.',
            mode: 'explain',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        cancelAgentRun({ runId: 'run-cancel', reason: 'User cancelled', requestedAt: 110 });
        acknowledgeAgentRunCancellation({ runId: 'run-cancel', level: 'consumer', acknowledgedAt: 111 });

        expect(getAgentRunControlProjection('run-cancel')?.cancellation).toEqual({
            requested: true,
            acknowledgement: 'consumer-only',
        });

        acknowledgeAgentRunCancellation({ runId: 'run-cancel', level: 'transport', acknowledgedAt: 112 });
        expect(getAgentRunControlProjection('run-cancel')?.cancellation.acknowledgement).toBe('transport');

        acknowledgeAgentRunCancellation({ runId: 'run-cancel', level: 'backend', acknowledgedAt: 113 });
        expect(getAgentRunControlProjection('run-cancel')).toMatchObject({
            phase: 'cancelled',
            cancellation: { requested: true, acknowledgement: 'backend' },
            allowedActions: { cancel: false, resume: false, retryWorkIds: [] },
        });
        expect(getAgentRun('run-cancel')?.cancellation.backendAcknowledgedAt).toBe(113);
    });

    it('withholds a stale decision resume control and exposes the re-preview reason', () => {
        const scope = { targetIds: ['track-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
        const grants = {
            allowedOperationPrefixes: ['muteTrack'],
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
        createAgentRun({
            runId: 'run-stale-decision',
            request: 'Mute Track 1.',
            mode: 'plan',
            createdRevision: captureProjectRevision(),
            scope,
            grants,
            budgets: { limits: {}, consumed: {} },
        });
        recordAgentRunDecision({
            runId: 'run-stale-decision',
            decision: {
                decisionId: 'decision-stale',
                capabilitySchemaIdentity: 'current-schema',
                proposalIdentity: 'proposal-stale',
                budgets: { limits: {}, consumed: {} },
                revision: 'obsolete-revision',
                scope,
                grants,
                alternatives: [{ id: 'mute', label: 'Mute Track 1', changesAuthority: false }],
                reason: 'Choose the bounded interpretation.',
                selectedAlternativeId: null,
                resumeAttemptId: null,
            },
        });
        requireAgentRunManualResume({
            runId: 'run-stale-decision',
            reason: 'Choose the bounded interpretation.',
            workIds: [],
        });

        expect(getAgentRunControlProjection('run-stale-decision')).toMatchObject({
            allowedActions: { resume: false },
            resumeRejectionReason: 'The project revision changed while the decision was pending.',
        });
    });
});
