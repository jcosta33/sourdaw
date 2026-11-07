import { describe, expect, it } from 'vitest';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { planAgentRun } from '../planAgentRun';

type Input = Parameters<typeof planAgentRun>[0];
const REVISION = 'initial-source-revision';
const STATE: MetricGoalState = { schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null };

function failure(overrides: Partial<ApplicationToolReceipt> = {}): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: 'initial-read',
        toolName: 'analysis.measure',
        turn: 0,
        origin: 'application-verification',
        status: 'failure',
        revision: null,
        data: null,
        summary: 'The initial render failed.',
        warnings: [],
        error: { code: 'render-failed', safeMessage: 'The initial render failed.', retryable: false },
        ...overrides,
    };
}
function input(overrides: Partial<Input> = {}): Input {
    return {
        request: 'Record a warmer mix brief.',
        revision: REVISION,
        actions: [{ type: 'setProductionBrief' }],
        actionLabels: ['Record the production brief'],
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: ['setProductionBrief'],
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
            limits: { maxCommands: 1, maxRenderJobs: 1, localAnalysis: 1 },
            consumed: { maxRenderJobs: 1, localAnalysis: 1 },
        },
        requiresConfirmation: true,
        metricGoalState: JSON.stringify(STATE),
        applicationToolReceipts: [failure()],
        initialBaselineRefusal: {
            schemaVersion: 1,
            sourceRevision: REVISION,
            stage: 'collection',
            receiptCallIds: ['initial-read'],
        },
        ...overrides,
    };
}

describe('optional initial-baseline failures at the non-acoustic brief boundary', () => {
    it('retains unavailable receipts and exhausted measurement capabilities while admitting only the brief', () => {
        const result = planAgentRun(input());
        expect(result).toMatchObject({
            status: 'planned',
            plan: {
                applicationToolReceipts: [failure()],
                capabilities: expect.arrayContaining([
                    expect.objectContaining({ id: 'analysis.measure', status: 'unavailable' }),
                    expect.objectContaining({ id: 'budget:maxRenderJobs', status: 'unavailable' }),
                    expect.objectContaining({ id: 'budget:localAnalysis', status: 'unavailable' }),
                ]),
            },
        });
        if (result.status !== 'planned') {
            throw new Error('Expected the soundless brief plan.');
        }
        expect(result.plan.steps.map((step) => step.actionType)).toEqual(['setProductionBrief']);
        expect(result.plan.expectedImpact.audible.status).toBe('not-claimed');
    });
    it('admits a real no-work preflight refusal with empty correlated reads', () => {
        expect(
            planAgentRun(
                input({
                    applicationToolReceipts: [],
                    initialBaselineRefusal: {
                        schemaVersion: 1,
                        sourceRevision: REVISION,
                        stage: 'preflight',
                        receiptCallIds: [],
                    },
                })
            )
        ).toMatchObject({ status: 'planned' });
    });
    it.each([
        { name: 'missing metadata', patch: { initialBaselineRefusal: undefined } },
        {
            name: 'wrong source revision',
            patch: {
                initialBaselineRefusal: {
                    schemaVersion: 1,
                    sourceRevision: 'different',
                    stage: 'collection',
                    receiptCallIds: ['initial-read'],
                },
            },
        },
        {
            name: 'unknown receipt id',
            patch: {
                initialBaselineRefusal: {
                    schemaVersion: 1,
                    sourceRevision: REVISION,
                    stage: 'collection',
                    receiptCallIds: ['unknown'],
                },
            },
        },
        {
            name: 'duplicate receipt id',
            patch: {
                initialBaselineRefusal: {
                    schemaVersion: 1,
                    sourceRevision: REVISION,
                    stage: 'collection',
                    receiptCallIds: ['initial-read', 'initial-read'],
                },
            },
        },
        {
            name: 'empty collection ids',
            patch: {
                initialBaselineRefusal: {
                    schemaVersion: 1,
                    sourceRevision: REVISION,
                    stage: 'collection',
                    receiptCallIds: [],
                },
            },
        },
        {
            name: 'preflight with read ids',
            patch: {
                initialBaselineRefusal: {
                    schemaVersion: 1,
                    sourceRevision: REVISION,
                    stage: 'preflight',
                    receiptCallIds: ['initial-read'],
                },
            },
        },
        { name: 'provider-origin receipt', patch: { applicationToolReceipts: [failure({ origin: undefined })] } },
        { name: 'wrong turn', patch: { applicationToolReceipts: [failure({ turn: 1 })] } },
        { name: 'wrong tool', patch: { applicationToolReceipts: [failure({ toolName: 'recipe.expand' })] } },
        { name: 'duplicate actual receipt', patch: { applicationToolReceipts: [failure(), failure()] } },
        {
            name: 'cancelled initial read',
            patch: {
                applicationToolReceipts: [
                    failure({ error: { code: 'cancelled', safeMessage: 'Cancelled', retryable: false } }),
                ],
            },
        },
        {
            name: 'stale initial read',
            patch: {
                applicationToolReceipts: [
                    failure({ error: { code: 'stale-revision', safeMessage: 'Stale', retryable: false } }),
                ],
            },
        },
        { name: 'malformed failure', patch: { applicationToolReceipts: [failure({ error: null })] } },
        { name: 'oversized failure', patch: { applicationToolReceipts: [failure({ summary: 'x'.repeat(20_000) })] } },
        {
            name: 'unrelated failure',
            patch: {
                applicationToolReceipts: [failure(), failure({ callId: 'unrelated', origin: undefined, turn: 2 })],
            },
        },
        {
            name: 'mixed actions',
            patch: {
                actions: [{ type: 'setProductionBrief' }, { type: 'setTrackGain' }],
                actionLabels: ['Brief', 'Gain'],
            },
        },
        { name: 'acoustic action', patch: { actions: [{ type: 'setTrackGain' }], actionLabels: ['Gain'] } },
        { name: 'scheduled continuation count', patch: { scheduledCommandCount: 1 } },
        {
            name: 'exhausted command budget',
            patch: {
                budgets: {
                    limits: { maxCommands: 1, maxRenderJobs: 1 },
                    consumed: { maxCommands: 1, maxRenderJobs: 1 },
                },
            },
        },
        { name: 'zero command budget', patch: { budgets: { limits: { maxCommands: 0 }, consumed: {} } } },
        {
            name: 'other exhausted budget',
            patch: {
                budgets: {
                    limits: { maxCommands: 1, maxRenderJobs: 1, remoteTokens: 1 },
                    consumed: { maxRenderJobs: 1, remoteTokens: 1 },
                },
            },
        },
        { name: 'missing action grant', patch: { grants: { ...input().grants, allowedOperationPrefixes: [] } } },
        { name: 'unreadable metric state', patch: { metricGoalState: '{}' } },
    ] satisfies readonly { name: string; patch: Partial<Input> }[])('does not waive $name', ({ patch }) => {
        expect(planAgentRun(input(patch))).toMatchObject({ status: 'rejected' });
    });
    it('does not turn an acoustic metric authority into optional initial evidence', () => {
        const state: MetricGoalState = {
            ...STATE,
            authorities: [
                {
                    schemaVersion: 1,
                    authorityId: 'acoustic',
                    origin: 'vibe-run-plan',
                    callId: null,
                    turn: null,
                    catalogId: 'catalog',
                    requestDigest: 'request',
                    revision: REVISION,
                    projectId: 'project',
                    selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
                    kind: 'perceptual',
                    creativeAuthority: null,
                    goals: [
                        {
                            goalId: 'centroid',
                            stepId: 'overall',
                            metricId: 'spectralCentroid',
                            band: null,
                            targetIds: ['drums'],
                            referenceTargetIds: [],
                            range: { startBeat: 0, endBeat: 4, sectionId: null },
                            relation: 'decrease',
                            targetValue: null,
                            tolerance: 0,
                            source: {
                                kind: 'recipe',
                                recipeId: 'drums-warm',
                                catalogVersion: 2,
                                recipeDigest: 'recipe',
                                expectationIndex: 1,
                            },
                        },
                    ],
                },
            ],
        };
        const serialized = JSON.stringify(state);
        expect(metricGoalStateCodec(serialized)).not.toBeNull();
        expect(planAgentRun(input({ metricGoalState: serialized }))).toMatchObject({ status: 'rejected' });
    });
    it('does not retain a recipe schedule under the brief-only exception', () => {
        const schedule: NonNullable<Input['batchSchedule']> = {
            schemaVersion: 1,
            kind: 'vibe-run',
            scheduleId: 'retained',
            position: 1,
            total: 2,
            totalCommands: 5,
            serializedProviderProposal: null,
            serializedPlan: '{}',
            briefRevision: 1,
            recordedConstraints: { constraints: [], unsupported: [] },
            slices: [],
        };
        expect(planAgentRun(input({ batchSchedule: schedule }))).toMatchObject({ status: 'rejected' });
    });
});
