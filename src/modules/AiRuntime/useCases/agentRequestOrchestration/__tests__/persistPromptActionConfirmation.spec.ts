import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistPromptActionConfirmation } from '../persistPromptActionConfirmation';

const mocks = vi.hoisted(() => ({
    createResourceLease: vi.fn(),
    describeRisk: vi.fn(),
    normalizeFailure: vi.fn(),
    proposeConfirmation: vi.fn(),
    recordError: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('../../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    proposePendingActionConfirmation: mocks.proposeConfirmation,
}));

vi.mock('../../agentErrorAndSaga', () => ({
    normalizeAgentFailure: mocks.normalizeFailure,
}));

vi.mock('../../agentReference/createStemImportConfirmationResourceLease', () => ({
    createStemImportConfirmationResourceLease: mocks.createResourceLease,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        recordError: mocks.recordError,
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: mocks.updateBatchStatus,
    },
}));

vi.mock('../../describeAgentRiskApproval', () => ({
    describeAgentRiskApproval: mocks.describeRisk,
}));

function createInput(): Parameters<typeof persistPromptActionConfirmation>[0] {
    const scope = {
        targetIds: ['track-kick'],
        targetRanges: [],
        protectedTargetIds: ['track-vocals'],
        protectedRanges: [],
    };
    const grants = {
        allowedOperationPrefixes: ['addTrack'],
        create: true,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    };
    return {
        runId: 'run-confirmation',
        prompt: 'Add a kick track',
        assistantMessageId: 'assistant-confirmation',
        actions: [{ type: 'addTrack', payload: { name: 'Kick', kind: 'audio' } }],
        actionLabels: ['Add Kick'],
        commandEnvelopes: ['command-envelope'],
        commandBatch: {
            serialized: '{}',
            authority: {
                projectId: 'project-confirmation',
                baseRevision: 'revision-confirmation',
                scope,
                grants,
                budgets: {
                    maxCommands: 1,
                    maxCreatedTracks: 1,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 1,
                    maxAffectedClips: 0,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 0,
                },
            },
        },
        agentApproval: {
            schemaVersion: 1,
            actionHashes: ['action-hash-add-kick'],
            sourceRevision: 'revision-confirmation',
            targetFingerprints: { 'track-kick': 'fingerprint-kick' },
            advertisedTargetFingerprints: {},
            consequences: {
                audioUpload: false,
                fileAccess: false,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
                remoteGeneration: false,
            },
            localActorId: 'actor-confirmation',
            policy: {
                decision: 'confirm',
                reasons: ['Creates a track.'],
                requiredTrustMode: 'apply-reversible',
                risk: 'bounded-reversible',
            },
        },
        affectedIds: ['track-kick'],
        protectedUnchanged: [{ id: 'track-vocals', name: 'Vocals' }],
        executionMode: 'atomic',
        group: { groupId: 'group-confirmation', groupLabel: 'Add Kick' },
        projectRevision: 'revision-confirmation',
        parsedCommandBatch: {
            status: 'valid',
            envelope: {
                batchId: 'batch-confirmation',
                commands: [{ commandId: 'command-add-kick' }],
                idempotencyKey: 'batch-confirmation-idempotency',
                preconditions: [],
                scope,
            },
        },
        content: 'Add Kick?',
    };
}

describe('persistPromptActionConfirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.describeRisk.mockReturnValue('Risk approval required.');
        mocks.createResourceLease.mockReturnValue({ bytes: 64 });
    });

    it('records a terminal capacity rejection in exact lifecycle and chat order', () => {
        const ordering: string[] = [];
        const normalizedFailure = { code: 'normalized-budget-failure' };
        mocks.createResourceLease.mockImplementation(() => {
            ordering.push('resource-lease');
            return { bytes: 64 };
        });
        mocks.proposeConfirmation.mockImplementation(() => {
            ordering.push('proposal-rejected');
            return null;
        });
        mocks.updateBatchStatus.mockImplementation(() => ordering.push('batch-failed'));
        mocks.normalizeFailure.mockReturnValue(normalizedFailure);
        mocks.recordError.mockImplementation(() => ordering.push('terminal-error'));
        mocks.updateChatMessage.mockImplementation(() => ordering.push('failed-chat'));
        mocks.transitionPhase.mockImplementation(() => ordering.push('success-transition'));

        persistPromptActionConfirmation(createInput());

        expect(ordering).toEqual([
            'resource-lease',
            'proposal-rejected',
            'batch-failed',
            'terminal-error',
            'failed-chat',
        ]);
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            batchId: 'batch-confirmation',
            status: 'failed',
        });
        expect(mocks.normalizeFailure).toHaveBeenCalledWith({
            category: 'budget',
            source: 'command-execution',
            related: {
                targetIds: ['track-kick'],
                commandIds: ['command-add-kick'],
                workIds: ['batch-confirmation'],
            },
            retry: 'never',
            knownDomain: true,
        });
        expect(mocks.recordError).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            error: normalizedFailure,
            terminal: true,
        });
        expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-confirmation', {
            isStreaming: false,
            pendingActionConfirmationStatus: 'failed',
            error: 'Prepared action resources exceed the live confirmation limit.',
            content:
                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
        });
        expect(mocks.transitionPhase).not.toHaveBeenCalled();
    });

    it('publishes the retained confirmation before waiting for approval', () => {
        const ordering: string[] = [];
        const resourceLease = { bytes: 64 };
        mocks.createResourceLease.mockImplementation(() => {
            ordering.push('resource-lease');
            return resourceLease;
        });
        mocks.proposeConfirmation.mockImplementation(() => {
            ordering.push('proposal-retained');
            return { id: 'retained-confirmation' };
        });
        mocks.updateChatMessage.mockImplementation(() => ordering.push('proposed-chat'));
        mocks.transitionPhase.mockImplementation(() => ordering.push('waiting-for-approval'));

        persistPromptActionConfirmation(createInput());

        expect(ordering).toEqual(['resource-lease', 'proposal-retained', 'proposed-chat', 'waiting-for-approval']);
        const proposal = mocks.proposeConfirmation.mock.calls[0]?.[0];
        expect(proposal).toEqual(
            expect.objectContaining({
                id: expect.stringMatching(/^prompt-confirmation-/),
                runId: 'run-confirmation',
                prompt: 'Add a kick track',
                assistantMessageId: 'assistant-confirmation',
                actionLabels: ['Add Kick'],
                commandEnvelopes: ['command-envelope'],
                affectedIds: ['track-kick'],
                protectedUnchanged: [{ id: 'track-vocals', name: 'Vocals' }],
                risk: { level: 'bounded-reversible', reason: 'Creates a track.' },
                executionMode: 'atomic',
                groupId: 'group-confirmation',
                groupLabel: 'Add Kick',
                projectRevision: 'revision-confirmation',
                resourceLease,
            })
        );
        expect(mocks.createResourceLease).toHaveBeenCalledWith(
            [{ type: 'addTrack', payload: { name: 'Kick', kind: 'audio' } }],
            `stem-promotion:${String(proposal?.id)}`,
            'run-confirmation'
        );
        expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-confirmation', {
            isStreaming: false,
            pendingActionConfirmationId: proposal?.id,
            pendingActionConfirmationStatus: 'proposed',
            content: 'Add Kick?\n\nRisk approval required.',
        });
        expect(mocks.transitionPhase).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            phase: 'waiting-for-approval',
            revision: 'revision-confirmation',
        });
        expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
        expect(mocks.recordError).not.toHaveBeenCalled();
    });
});
