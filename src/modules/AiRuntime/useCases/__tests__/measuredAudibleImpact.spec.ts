import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import {
    type MeasuredMetricDelta,
    type MeasuredMetricEntry,
    type MeasuredPreview,
    type MeasuredPreviewTarget,
} from '../../models/MeasuredPreview';
import { persistAgentRunState, readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { chatStore } from '../../stores/chatStore';
import { getPendingActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';

import {
    configuredLiteralMetricState,
    configureMetricGoalProject,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

const RUN_ID = 'measured-audible-run';
const ASSISTANT_ID = 'measured-audible-assistant';

type AudibleClaim = NonNullable<ReturnType<typeof agentRunLifecycle.get>>['plan'] extends infer Plan
    ? NonNullable<Plan>['expectedImpact']['audible']
    : never;

function entry(unit: string, value: number): MeasuredMetricEntry {
    return { status: 'measured', metricVersion: 1, unit, value, confidence: 'exact' };
}

function compared(unit: string, delta: number): MeasuredMetricDelta {
    return { status: 'compared', delta, unit };
}

/** An RMS that moved, a true peak that did not, and a crest factor the two renders cannot compare. */
function vocalTarget(overrides: Partial<MeasuredPreviewTarget> = {}): MeasuredPreviewTarget {
    return {
        targetId: 'vocal',
        targetKind: 'track',
        baseline: {
            rms: entry('dBFS', -20.123456789),
            truePeak: entry('dBTP', -3.25),
            crestFactor: entry('dB', 9.5),
        },
        preview: {
            rms: entry('dBFS', -17.0000001),
            truePeak: entry('dBTP', -3.25),
            crestFactor: entry('dB', 8.5),
        },
        deltas: {
            rms: compared('dBFS', 3.123456689),
            truePeak: compared('dBTP', 0),
            crestFactor: { status: 'incomparable', reason: 'The crest factor is not comparable here.' },
        },
        ...overrides,
    };
}

type Card = { confirmationId: string; envelope: Parameters<typeof digestCommandBatchContent>[0] };

/** Persists one real approval card for `gain` on the run, with a preview built for that exact batch. */
function proposeCard(input: {
    gain: number;
    preview?: (bound: { revision: string; batchContentHash: string }) => MeasuredPreview;
    /** A preview held only by the metric-goal proofs, as a vibe-run batch card holds it. */
    proofPreviews?: readonly ((bound: { revision: string; batchContentHash: string }) => MeasuredPreview)[];
    foreignHash?: boolean;
}): Card {
    const revision = captureProjectRevision();
    const actions = [
        { type: 'setTrackGain' as const, payload: { trackId: 'vocal', gain: input.gain, expectedGain: 1 } },
    ];
    const compiled = compileAgentActionExecution({
        actions,
        actionLabels: ['setTrackGain'],
        context: getProjectContext(),
        group: { groupId: `group-${String(input.gain)}`, groupLabel: 'Set vocal gain' },
        intent: 'Set the vocal gain',
        projectRevision: revision,
        requiresConfirmation: true,
        runId: RUN_ID,
    });
    if (compiled.agentApproval === null) {
        throw new Error('Expected a risk approval for the confirmation-required batch.');
    }
    const parsed = parseBatch(compiled.commandBatch);
    const batchContentHash = input.foreignHash === true ? 'another-batch' : digestCommandBatchContent(parsed.envelope);
    const confirmationId = persistPromptActionConfirmation({
        runId: RUN_ID,
        prompt: 'Set the vocal gain',
        assistantMessageId: ASSISTANT_ID,
        actions,
        actionLabels: ['setTrackGain'],
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: compiled.agentApproval,
        affectedIds: ['vocal'],
        protectedUnchanged: [],
        metricGoalState: proofOnlyState(
            compiled.commandBatch,
            input.proofPreviews?.map((build) => build({ revision, batchContentHash }))
        ),
        measuredPreview: input.preview?.({ revision, batchContentHash }),
        executionMode: 'atomic',
        group: { groupId: `group-${String(input.gain)}`, groupLabel: 'Set vocal gain' },
        projectRevision: revision,
        parsedCommandBatch: parsed,
        content: 'Set the vocal gain',
    });
    if (confirmationId === null) {
        throw new Error('The approval card was not retained.');
    }
    return { confirmationId, envelope: parsed.envelope };
}

function proofOnlyState(
    commandBatch: ReturnType<typeof compileAgentActionExecution>['commandBatch'],
    previews: readonly MeasuredPreview[] | undefined
): string | undefined {
    if (previews === undefined) {
        return undefined;
    }
    const state = JSON.parse(configuredLiteralMetricState(commandBatch)) as Record<string, unknown>;
    const artifact = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'content-address' } };
    const proofs = previews.map((preview, index) => ({
        preview: {
            ...preview,
            provenance: {
                origin: 'approval-preview' as const,
                callId: `proof-call-${String(index)}`,
                turn: index,
                runId: RUN_ID,
                targets: preview.targets.map((target) => ({
                    targetId: target.targetId,
                    baseline: artifact,
                    preview: artifact,
                })),
            },
        },
        receiptDigest: `proof-receipt-digest-${String(index)}`,
    }));
    return JSON.stringify({ ...state, proofs });
}

function parseBatch(commandBatch: ReturnType<typeof compileAgentActionExecution>['commandBatch']) {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected a valid compiled batch.');
    }
    return parsed;
}

function previewOf(
    targets: readonly MeasuredPreviewTarget[]
): (bound: { revision: string; batchContentHash: string }) => MeasuredPreview {
    return ({ revision, batchContentHash }) => ({
        scope: { kind: 'tracks', ids: ['vocal'] },
        range: { startBeat: 0, endBeat: 4, sectionId: null },
        targets,
        batchContentHash,
        revision,
    });
}

function audible(): AudibleClaim {
    const plan = agentRunLifecycle.get(RUN_ID)?.plan;
    if (plan === null || plan === undefined) {
        throw new Error('Expected the run to carry a plan.');
    }
    return plan.expectedImpact.audible;
}

function movedFiguresFromApprovalCard(confirmationId: string) {
    const view = getAgentApprovalView({ confirmationId });
    return (view?.measuredPreview?.targets ?? []).flatMap((target) =>
        target.metrics.flatMap((metric) => {
            if (
                metric.baseline === null ||
                metric.preview === null ||
                metric.delta === null ||
                metric.delta.value === 0
            ) {
                return [];
            }
            return [
                {
                    targetId: target.targetId,
                    targetKind: target.targetKind,
                    metricId: metric.metricId,
                    baseline: metric.baseline,
                    preview: metric.preview,
                    delta: metric.delta,
                },
            ];
        })
    );
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'measured audible impact',
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            createTrack({ id: 'vocal', name: 'Lead Vocal', kind: 'audio' }),
        ],
        sections: [],
    });
    chatStore.set({
        messages: [{ id: ASSISTANT_ID, role: 'assistant', content: 'Planning', timestamp: 1 }],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
    expect(
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'Set the vocal gain',
            mode: 'apply',
            createdRevision: captureProjectRevision(),
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    const run = agentRunLifecycle.get(RUN_ID);
    if (run === null) {
        throw new Error('Expected the created run.');
    }
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Set the vocal gain',
        commandIds: [],
        serializedBatchIdentity: null,
        revision: captureProjectRevision(),
        scope: run.scope,
        grants: run.grants,
        budgets: run.budgets,
    });
});

afterEach(() => {
    resetMetricGoalProject();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

describe('the plan’s audible claim', () => {
    it('lists each moved metric with the measurement’s own figures and its definition’s unit', () => {
        const card = proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error(`Expected a measured claim, got: ${JSON.stringify(claim)}`);
        }
        expect(claim.revision).toBe(captureProjectRevision());
        expect(claim.batchContentHash).toBe(digestCommandBatchContent(card.envelope));
        expect(claim.metrics).toEqual(movedFiguresFromApprovalCard(card.confirmationId));
        // The held true peak and the incomparable crest factor are not claimed as moved.
        expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['rms']);
        expect(claim.metrics[0]).toEqual({
            targetId: 'vocal',
            targetKind: 'track',
            metricId: 'rms',
            baseline: { value: -20.123456789, unit: 'dBFS' },
            preview: { value: -17.0000001, unit: 'dBFS' },
            delta: { value: 3.123456689, unit: 'dBFS' },
        });
    });

    it('claims a preview held only by the metric-goal proofs, as a vibe-run batch card holds it', () => {
        const card = proposeCard({ gain: 0.7, proofPreviews: [previewOf([vocalTarget()])] });
        const snapshot = getPendingActionConfirmation(card.confirmationId)?.approvalSnapshot;
        expect(snapshot?.measuredPreview).toBeUndefined();
        expect(metricGoalStateCodec(snapshot?.metricGoalState)?.proofs).toHaveLength(1);
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error(`Expected the proof's preview to be claimed, got: ${JSON.stringify(claim)}`);
        }
        // The card view reads only the snapshot's preview, so the expectation is the proof's own figures.
        expect(claim.metrics).toEqual([
            {
                targetId: 'vocal',
                targetKind: 'track',
                metricId: 'rms',
                baseline: { value: -20.123456789, unit: 'dBFS' },
                preview: { value: -17.0000001, unit: 'dBFS' },
                delta: { value: 3.123456689, unit: 'dBFS' },
            },
        ]);
    });

    describe('which measurement the claim comes from', () => {
        const masterTarget = (rmsPreview: number, delta: number): MeasuredPreviewTarget => ({
            targetId: 'master',
            targetKind: 'master',
            baseline: { rms: entry('dBFS', -14) },
            preview: { rms: entry('dBFS', rmsPreview) },
            deltas: { rms: compared('dBFS', delta) },
        });
        const heldMaster = masterTarget(-14, 0);
        const vocalRms = (previewDb: number, delta: number): MeasuredPreviewTarget =>
            vocalTarget({
                preview: { rms: entry('dBFS', previewDb) },
                deltas: { rms: compared('dBFS', delta) },
            });

        it('claims exactly what the card shows when the snapshot preview binds, whatever later proofs measured', () => {
            const card = proposeCard({
                gain: 0.7,
                preview: previewOf([vocalTarget()]),
                proofPreviews: [previewOf([vocalTarget()]), previewOf([heldMaster])],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error(`Expected the card's measurement to be claimed, got: ${JSON.stringify(claim)}`);
            }
            expect(claim.metrics).toEqual(movedFiguresFromApprovalCard(card.confirmationId));
            expect(claim.metrics.length).toBeGreaterThan(0);
        });

        it('lists metrics of different targets from different proofs when the card has no snapshot preview', () => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [previewOf([vocalRms(-17, 3)]), previewOf([masterTarget(-12, 2)])],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error('Expected both proofs to be claimed.');
            }
            expect(claim.metrics.map((metric) => `${metric.targetId}:${metric.metricId}`)).toEqual([
                'vocal:rms',
                'master:rms',
            ]);
        });

        it('takes the latest bound proof for the same target and metric, keeping the others', () => {
            const oldVocal = vocalTarget({
                preview: { rms: entry('dBFS', -17), truePeak: entry('dBTP', -2.25) },
                deltas: { rms: compared('dBFS', 3), truePeak: compared('dBTP', 1) },
            });
            proposeCard({
                gain: 0.7,
                proofPreviews: [previewOf([oldVocal]), previewOf([vocalRms(-15.5, 4.5)])],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error('Expected the merged proofs to be claimed.');
            }
            expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['rms', 'truePeak']);
            expect(claim.metrics[0]?.preview).toEqual({ value: -15.5, unit: 'dBFS' });
            expect(claim.metrics[0]?.delta).toEqual({ value: 4.5, unit: 'dBFS' });
            expect(claim.metrics[1]?.preview).toEqual({ value: -2.25, unit: 'dBTP' });
        });

        it('never claims from a proof of another batch', () => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [
                    (bound) => ({ ...previewOf([vocalTarget()])(bound), batchContentHash: 'another-batch' }),
                ],
            });
            expect(audible().status).toBe('not-claimed');
        });

        it('never claims from a proof measured at another revision', () => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [(bound) => ({ ...previewOf([vocalTarget()])(bound), revision: 'another-revision' })],
            });
            expect(audible().status).toBe('not-claimed');
        });
    });

    it('does not claim a figure whose unit disagrees with the metric definition', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([
                vocalTarget({
                    baseline: { rms: entry('LUFS', -20), truePeak: entry('dBTP', -3), crestFactor: entry('dB', 9) },
                    preview: { rms: entry('LUFS', -17), truePeak: entry('dBTP', -2), crestFactor: entry('dB', 8) },
                    deltas: {
                        rms: compared('LUFS', 3),
                        truePeak: compared('dBTP', 1),
                        crestFactor: compared('dB', -1),
                    },
                }),
            ]),
        });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error('The metrics with matching units are still claimed.');
        }
        expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['truePeak', 'crestFactor']);
    });

    it('claims nothing when every compared metric held', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([
                vocalTarget({
                    preview: {
                        rms: entry('dBFS', -20.123456789),
                        truePeak: entry('dBTP', -3.25),
                        crestFactor: entry('dB', 9.5),
                    },
                    deltas: { rms: compared('dBFS', 0), truePeak: compared('dBTP', 0) },
                }),
            ]),
        });
        expect(audible().status).toBe('not-claimed');
    });

    it('carries only not-claimed for a card with no measured preview', () => {
        proposeCard({ gain: 0.7 });
        expect(audible().status).toBe('not-claimed');
    });

    it('does not claim a preview that measured another batch', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]), foreignHash: true });
        expect(audible().status).toBe('not-claimed');
    });

    it('does not let a later batch inherit the earlier batch’s claim', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        expect(audible().status).toBe('measured');
        const run = agentRunLifecycle.get(RUN_ID);
        if (run?.plan === null || run === null) {
            throw new Error('Expected the run plan.');
        }
        // The scheduler records the next batch's plan, carrying the schedule forward, before its card.
        agentRunLifecycle.recordPlan({
            runId: RUN_ID,
            summary: run.plan.summary,
            commandIds: run.plan.commandIds,
            serializedBatchIdentity: run.plan.serializedBatchIdentity,
            revision: captureProjectRevision(),
            scope: run.scope,
            grants: run.grants,
            budgets: run.budgets,
            plan: {
                ...run.plan,
                batchSchedule: {
                    kind: 'bulk-set',
                    schemaVersion: 1,
                    scheduleId: 'schedule',
                    position: 2,
                    total: 2,
                    totalCommands: 2,
                    interactionMode: 'apply',
                    trustCeiling: null,
                    serializedProviderProposal: null,
                    slices: [1, 2].map((position) => ({
                        position,
                        commandCount: 1,
                        targetIds: ['vocal'],
                        serializedSlice: `slice-${String(position)}`,
                    })),
                },
            },
        });
        expect(audible().status).toBe('not-claimed');
        proposeCard({ gain: 0.6 });
        expect(audible().status).toBe('not-claimed');
    });

    it('claims the new measurement after a re-preview, and nothing once a later re-preview carries none', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        const replacement = vocalTarget({
            preview: {
                rms: entry('dBFS', -15.5),
                truePeak: entry('dBTP', -3.25),
                crestFactor: entry('dB', 8.5),
            },
            deltas: {
                rms: compared('dBFS', 4.623456789),
                truePeak: compared('dBTP', 0),
            },
        });
        const second = proposeCard({ gain: 0.7, preview: previewOf([replacement]) });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error('Expected the replacement measurement to be claimed.');
        }
        expect(claim.metrics).toEqual(movedFiguresFromApprovalCard(second.confirmationId));
        expect(claim.metrics[0]?.preview).toEqual({ value: -15.5, unit: 'dBFS' });
        proposeCard({ gain: 0.7 });
        expect(audible().status).toBe('not-claimed');
    });

    it.each([
        [
            'a bare plan rewrite',
            (run: NonNullable<ReturnType<typeof agentRunLifecycle.get>>) =>
                agentRunLifecycle.recordPlan({
                    runId: RUN_ID,
                    summary: 'Rewritten',
                    commandIds: [],
                    serializedBatchIdentity: null,
                    revision: captureProjectRevision(),
                    scope: run.scope,
                    grants: run.grants,
                    budgets: run.budgets,
                    plan: run.plan ?? undefined,
                }),
        ],
        [
            'a metric-goal rebind',
            (run: NonNullable<ReturnType<typeof agentRunLifecycle.get>>) => {
                agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'waiting-for-approval' });
                agentRunLifecycle.rebindMetricGoalState({
                    runId: RUN_ID,
                    expectedMetricGoalState: run.plan?.metricGoalState,
                    metricGoalState: '{}',
                    revision: captureProjectRevision(),
                });
            },
        ],
        [
            'application tool evidence',
            (run: NonNullable<ReturnType<typeof agentRunLifecycle.get>>) =>
                agentRunLifecycle.recordApplicationToolEvidence({
                    runId: RUN_ID,
                    summary: 'Evidence',
                    applicationToolReceipts: [],
                    revision: captureProjectRevision(),
                    scope: run.scope,
                    grants: run.grants,
                    budgets: run.budgets,
                }),
        ],
    ])('never carries a claim across %s', (_name, write) => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        expect(audible().status).toBe('measured');
        const run = agentRunLifecycle.get(RUN_ID);
        if (run === null) {
            throw new Error('Expected the run.');
        }
        write(run);
        expect(audible().status).toBe('not-claimed');
    });

    it('round-trips through the persisted run codec', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        const before = audible();
        expect(before.status).toBe('measured');
        persistAgentRunState(readAgentRunState());
        const hydrated = sanitizeAgentRunState(structuredClone(readAgentRunState()));
        expect(hydrated.runs.find((run) => run.runId === RUN_ID)?.plan?.expectedImpact.audible).toEqual(before);
    });

    it('drops a run whose measured claim is malformed, as it does for other malformed plan fields', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        const stored: unknown = structuredClone(readAgentRunState());
        const corrupt = (mutate: (impact: Record<string, unknown>) => void): number => {
            const copy = structuredClone(stored) as {
                runs: { plan: { expectedImpact: Record<string, unknown> } }[];
            };
            for (const run of copy.runs) {
                mutate(run.plan.expectedImpact);
            }
            return sanitizeAgentRunState(copy).runs.length;
        };
        expect(corrupt(() => undefined)).toBe(1);
        const reference = corrupt((impact) => {
            impact.project = 7;
        });
        expect(reference).toBe(0);
        expect(
            corrupt((impact) => {
                (impact.audible as { metrics: unknown }).metrics = 'not-a-list';
            })
        ).toBe(reference);
        expect(
            corrupt((impact) => {
                const claim = impact.audible as { metrics: { baseline: { value: unknown } }[] };
                claim.metrics[0]!.baseline.value = 'loud';
            })
        ).toBe(reference);
        expect(
            corrupt((impact) => {
                (impact.audible as { batchContentHash: unknown }).batchContentHash = '';
            })
        ).toBe(reference);
    });
});
