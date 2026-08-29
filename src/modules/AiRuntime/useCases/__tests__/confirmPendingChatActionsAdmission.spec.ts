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

    it('forwards only the consumed retry admission to the retry executor and returns its busy result', async () => {
        const admission = { status: 'render-retry', confirmation, durableReceipt, commandBatch } as const;
        mocks.resolveAdmission.mockResolvedValue(admission);
        mocks.consumeAdmission.mockReturnValue(admission);
        mocks.executeRetry.mockResolvedValue({ status: 'busy' });

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'busy',
        });
        expect(mocks.consumeAdmission).toHaveBeenCalledWith(admission);
        expect(mocks.executeRetry).toHaveBeenCalledWith({ confirmation, durableReceipt, commandBatch });
    });
});
