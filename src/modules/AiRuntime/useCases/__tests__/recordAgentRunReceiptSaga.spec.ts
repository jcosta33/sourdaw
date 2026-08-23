import { beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { recordAgentRunReceiptSaga } from '../recordAgentRunReceiptSaga';

type Receipt = Parameters<typeof recordAgentRunReceiptSaga>[0]['receipt'];
type PendingEffect = Receipt['pendingEffects'][number];
type CommandBatch = NonNullable<Parameters<typeof recordAgentRunReceiptSaga>[0]['commandBatch']>;

const BASE_REVISION = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});

const ACTIONS = [
    {
        type: 'setTrackGain',
        payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
    },
    {
        type: 'setTrackPan',
        payload: { trackId: 'track-vocal', pan: -0.2, expectedPan: 0 },
    },
] satisfies AppAction[];

const COMMAND_BATCH: CommandBatch = {
    authority: {
        projectId: 'project-agent-effects',
        baseRevision: BASE_REVISION,
        scope: {
            targetIds: ['track-vocal'],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        grants: {
            allowedOperationPrefixes: ['setTrack'],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: true,
        },
        budgets: {
            maxCommands: 2,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 1,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    },
    serialized: '{"batch":"agent-effects"}',
};

function createReceipt(pendingEffects: readonly PendingEffect[]): Receipt {
    const revision = {
        normalizedRevision: BASE_REVISION,
        documentIdentityEpoch: 1,
        mutationEpoch: 0,
        documents: [{ docId: 'root', heads: ['head-0'] }],
    };
    return {
        schemaVersion: 1,
        runId: 'run-agent-effects',
        batchId: 'batch-agent-effects',
        outcome: 'partially-committed',
        atomicity: 'durable-atomic-with-non-atomic-effects',
        base: revision,
        observedBase: revision,
        resulting: revision,
        commandOutcomes: pendingEffects.map((effect) => ({
            commandId: effect.commandId,
            operation: effect.operation,
            outcome: 'committed' as const,
            affectedIds: ['track-vocal'],
            compensationAvailable: true,
        })),
        affectedIds: ['track-vocal'],
        createdBindings: [],
        warnings: ['A post-commit effect remains pending.'],
        errors: [],
        pendingEffects: [...pendingEffects],
        links: { render: [], analysis: [] },
        compensation: { available: true, commandIds: pendingEffects.map(({ commandId }) => commandId) },
        semanticDiff: null,
        modelSummary: 'The project committed with pending effects.',
    };
}

function createRun(): void {
    agentRunLifecycle.create({
        runId: 'run-agent-effects',
        request: 'Apply the approved project changes.',
        mode: 'apply',
        createdRevision: BASE_REVISION,
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({
        runId: 'run-agent-effects',
        phase: 'planning',
        revision: BASE_REVISION,
        transitionedAt: 101,
    });
    agentRunLifecycle.transitionPhase({
        runId: 'run-agent-effects',
        phase: 'executing',
        revision: BASE_REVISION,
        transitionedAt: 102,
    });
}

describe('recordAgentRunReceiptSaga', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        createRun();
    });

    it('persists a generic reconciliable effect and blocks terminal completion', () => {
        const genericEffect = {
            commandId: '11111111-1111-4111-8111-111111111111',
            kind: 'external-effect' as const,
            operation: 'setTrackGain' as const,
            reason: 'render publication queue unavailable',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: createReceipt([genericEffect]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [genericEffect],
                    recovery: 'reconcile-batch',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        stepId: 'effect:batch-agent-effects:11111111-1111-4111-8111-111111111111',
                        owner: 'external-effect',
                        state: 'external-pending',
                    }),
                ]),
            },
        });
    });

    it('persists every effect in a mixed batch as one receipt-bound continuation', () => {
        const runtimeEffect = {
            commandId: '11111111-1111-4111-8111-111111111111',
            kind: 'runtime-graph' as const,
            operation: 'setTrackGain' as const,
            reason: 'runtime graph revision is stale',
            remediation: 'repair' as const,
            state: 'pending' as const,
        };
        const genericEffect = {
            commandId: '22222222-2222-4222-8222-222222222222',
            kind: 'external-effect' as const,
            operation: 'setTrackPan' as const,
            reason: 'render publication queue unavailable',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: createReceipt([runtimeEffect, genericEffect]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [runtimeEffect, genericEffect],
                    recovery: 'reconcile-batch',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ stepId: `effect:batch-agent-effects:${runtimeEffect.commandId}` }),
                    expect.objectContaining({ stepId: `effect:batch-agent-effects:${genericEffect.commandId}` }),
                ]),
            },
        });
    });
});
