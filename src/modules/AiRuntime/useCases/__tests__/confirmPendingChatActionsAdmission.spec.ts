import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmPendingChatActions } from '../confirmPendingChatActions';

import type { PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';

const mocks = vi.hoisted(() => ({
    consumeAdmission: vi.fn(),
    executeRetry: vi.fn(),
    resolveAdmission: vi.fn(),
}));

vi.mock('../agentRequestOrchestration/resolveConfirmationAdmission', () => ({
    confirmationAdmission: {
        consumeConfirmationAdmission: mocks.consumeAdmission,
        resolveConfirmationAdmission: mocks.resolveAdmission,
    },
}));
vi.mock('../agentRequestOrchestration/executeCommittedSectionRenderRetry', () => ({
    executeCommittedSectionRenderRetry: mocks.executeRetry,
}));

const confirmation = {
    id: 'confirmation-retry',
    runId: 'run-retry',
    prompt: 'Render Verse',
    assistantMessageId: 'assistant-retry',
    actionLabels: ['Render Verse'],
    affectedIds: ['section-verse'],
    protectedUnchanged: [],
    risk: null,
    executedActions: [],
    status: 'executed',
    error: 'Renderer unavailable.',
    followUpProjectRevision: 'revision-source',
    followUpStatus: 'retryable',
    createdAt: 1,
    resolvedAt: 2,
    kind: 'app_actions',
    projectRevision: 'revision-source',
    actions: [],
    approvalSnapshot: { actions: [], actionLabels: [], protectedUnchanged: [] },
    executionMode: 'atomic',
    groupId: 'batch-retry',
} satisfies PendingAppActionConfirmation;

const durableReceipt = {
    schemaVersion: 2,
    runId: 'run-retry',
    batchId: 'batch-retry',
    outcome: 'partially-committed',
    atomicity: 'durable-atomic-with-non-atomic-effects',
    commandOutcomes: [],
    pendingEffects: [],
} as const;

const commandBatch = {
    serialized: 'approved-retry-batch',
    authority: {
        projectId: 'project-1',
        baseRevision: 'revision-source',
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
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
    },
} as const;

describe('confirmPendingChatActions retry admission', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a changed handled admission without invoking the retry executor', async () => {
        const resolvedAdmission = { status: 'render-retry', confirmation, durableReceipt, commandBatch } as const;
        mocks.resolveAdmission.mockResolvedValue(resolvedAdmission);
        mocks.consumeAdmission.mockReturnValue({ status: 'handled', result: { status: 'missing' } });

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'missing',
        });
        expect(mocks.consumeAdmission).toHaveBeenCalledWith(resolvedAdmission);
        expect(mocks.executeRetry).not.toHaveBeenCalled();
    });

    it('forwards the distinct consumed retry payload rather than the resolved payload', async () => {
        const resolvedAdmission = { status: 'render-retry', confirmation, durableReceipt, commandBatch } as const;
        const consumedConfirmation = { ...confirmation, id: 'confirmation-retry-live' };
        const consumedReceipt = { ...durableReceipt, batchId: 'batch-retry-live' };
        const consumedCommandBatch = { ...commandBatch, serialized: 'approved-live-retry-batch' };
        const consumedAdmission = {
            status: 'render-retry',
            confirmation: consumedConfirmation,
            durableReceipt: consumedReceipt,
            commandBatch: consumedCommandBatch,
        } as const;
        mocks.resolveAdmission.mockResolvedValue(resolvedAdmission);
        mocks.consumeAdmission.mockReturnValue(consumedAdmission);
        mocks.executeRetry.mockResolvedValue({ status: 'busy' });

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'busy',
        });
        expect(mocks.consumeAdmission).toHaveBeenCalledWith(resolvedAdmission);
        expect(mocks.executeRetry).toHaveBeenCalledWith({
            confirmation: consumedConfirmation,
            durableReceipt: consumedReceipt,
            commandBatch: consumedCommandBatch,
        });
    });
});
