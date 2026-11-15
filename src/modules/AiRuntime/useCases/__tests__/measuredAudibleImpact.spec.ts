import { parse, stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { compareAgentScopeMeasurements } from '#/modules/AudioAnalysis/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AGENT_RUN_MAX_TEXT_LENGTH, MAX_AUDIBLE_CLAIM_METRICS } from '../../models/AgentRun';
import {
    type MeasuredMetricDelta,
    type MeasuredPreview,
    type MeasuredPreviewTarget,
} from '../../models/MeasuredPreview';
import { persistAgentRunState, readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { chatStore } from '../../stores/chatStore';
import { getPendingActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { AUDIBLE_CLAIM_TOO_LARGE_REASON, NO_AUDIBLE_CLAIM_REASON } from '../deriveMeasuredAudibleImpact';
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

type AudibleClaim = NonNullable<
    NonNullable<ReturnType<typeof agentRunLifecycle.get>>['plan']
>['expectedImpact']['audible'];

type FigureUnit = 'dBFS' | 'dBTP' | 'LUFS' | 'dB';

function entry(unit: FigureUnit, value: number) {
    return { status: 'measured' as const, metricVersion: 1 as const, unit, value, confidence: 'exact' as const };
}

/** The change between two figures of `unit` exactly as the measurement reports it, by the real comparison. */
function compared(unit: FigureUnit, delta: number): MeasuredMetricDelta {
    const change = compareAgentScopeMeasurements({
        baseline: { rms: entry(unit, 0) },
        preview: { rms: entry(unit, delta) },
    }).rms;
    if (change === undefined) {
        throw new Error('The comparison reported nothing.');
    }
    return change;
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
    const range = view?.measuredPreview?.range;
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
                    range,
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
            range: { startBeat: 0, endBeat: 4, sectionId: null },
            metricId: 'rms',
            baseline: { value: -20.123456789, unit: 'dBFS' },
            preview: { value: -17.0000001, unit: 'dBFS' },
            delta: { value: 3.123456689, unit: 'dB' },
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
                range: { startBeat: 0, endBeat: 4, sectionId: null },
                metricId: 'rms',
                baseline: { value: -20.123456789, unit: 'dBFS' },
                preview: { value: -17.0000001, unit: 'dBFS' },
                delta: { value: 3.123456689, unit: 'dB' },
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
        const vocalRms = (previewDb: number, delta: number): MeasuredPreviewTarget =>
            vocalTarget({
                preview: { rms: entry('dBFS', previewDb) },
                deltas: { rms: compared('dBFS', delta) },
            });

        it('claims exactly what the card shows when the snapshot preview binds, whatever later proofs measured', () => {
            const card = proposeCard({
                gain: 0.7,
                preview: previewOf([vocalTarget()]),
                // A later proof of the same batch moves different figures; the card never showed them.
                proofPreviews: [previewOf([vocalTarget()]), previewOf([vocalRms(-10, 10.123456789)])],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error(`Expected the card's measurement to be claimed, got: ${JSON.stringify(claim)}`);
            }
            expect(claim.metrics).toEqual(movedFiguresFromApprovalCard(card.confirmationId));
            expect(claim.metrics.map((metric) => metric.delta.value)).toEqual([3.123456689]);
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
            expect(claim.metrics[0]?.delta).toEqual({ value: 4.5, unit: 'dB' });
            expect(claim.metrics[1]?.preview).toEqual({ value: -2.25, unit: 'dBTP' });
        });

        const loudness = (delta: MeasuredMetricDelta, previewLufs: number): MeasuredPreviewTarget => ({
            targetId: 'master',
            targetKind: 'master',
            baseline: { integratedLoudness: entry('LUFS', -14) },
            preview: { integratedLoudness: entry('LUFS', previewLufs) },
            deltas: { integratedLoudness: delta },
        });
        const over = (
            range: MeasuredPreview['range'],
            targets: readonly MeasuredPreviewTarget[]
        ): ((bound: { revision: string; batchContentHash: string }) => MeasuredPreview) => {
            return (bound) => ({ ...previewOf(targets)(bound), range });
        };
        const R1 = { startBeat: 0, endBeat: 4, sectionId: null };
        const R2 = { startBeat: 4, endBeat: 8, sectionId: 'chorus' };

        it.each([
            ['held', compared('LUFS', 0)],
            ['incomparable', { status: 'incomparable', reason: 'The renders cannot be compared.' } as const],
        ])('lets a later proof that measures the metric as %s replace an earlier moved figure', (_name, later) => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [over(R1, [loudness(compared('LUFS', 1.5), -12.5)]), over(R1, [loudness(later, -14)])],
            });
            expect(audible().status).toBe('not-claimed');
        });

        it('lists one metric measured over different ranges once per range, each with its range', () => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [
                    over(R1, [loudness(compared('LUFS', 1.5), -12.5)]),
                    over(R2, [loudness(compared('LUFS', 0.8), -13.2)]),
                ],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error('Expected both ranges to be claimed.');
            }
            expect(claim.metrics.map((metric) => [metric.range, metric.delta.value])).toEqual([
                [R1, 1.5],
                [R2, 0.8],
            ]);
        });

        it('lists one metric over equal beats in two sections once per section', () => {
            const verse = { startBeat: 0, endBeat: 4, sectionId: 'verse' };
            const chorus = { startBeat: 0, endBeat: 4, sectionId: 'chorus' };
            proposeCard({
                gain: 0.7,
                proofPreviews: [
                    over(verse, [loudness(compared('LUFS', 1.5), -12.5)]),
                    over(chorus, [loudness(compared('LUFS', 0.8), -13.2)]),
                ],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error('Expected both sections to be claimed.');
            }
            expect(claim.metrics.map((metric) => [metric.range, metric.delta.value])).toEqual([
                [verse, 1.5],
                [chorus, 0.8],
            ]);
        });

        it.each([
            {
                label: 'differ only in end beat',
                first: { startBeat: 0, endBeat: 4, sectionId: null },
                second: { startBeat: 0, endBeat: 8, sectionId: null },
            },
            {
                label: 'differ only in start beat',
                first: { startBeat: 0, endBeat: 8, sectionId: null },
                second: { startBeat: 4, endBeat: 8, sectionId: null },
            },
        ])('lists one metric over two ranges that $label once per range', ({ first, second }) => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [
                    over(first, [loudness(compared('LUFS', 1.5), -12.5)]),
                    over(second, [loudness(compared('LUFS', 0.8), -13.2)]),
                ],
            });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error('Expected both ranges to be claimed.');
            }
            expect(claim.metrics.map((metric) => [metric.range, metric.delta.value])).toEqual([
                [first, 1.5],
                [second, 0.8],
            ]);
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

    it('does not claim a figure stated in a unit other than its metric definition even when the change unit is right', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([
                vocalTarget({
                    baseline: { rms: entry('dB', -20), truePeak: entry('dBTP', -3), crestFactor: entry('dB', 9) },
                    preview: { rms: entry('dB', -17), truePeak: entry('dBTP', -2), crestFactor: entry('dB', 8) },
                    deltas: {
                        rms: compared('dB', 3),
                        truePeak: compared('dB', 1),
                        crestFactor: compared('dB', -1),
                    },
                }),
            ]),
        });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error('The metrics with matching figure units are still claimed.');
        }
        expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['truePeak', 'crestFactor']);
    });

    it('claims loudness, true peak and rms changes in the units the real comparison reports', () => {
        const baseline = {
            integratedLoudness: entry('LUFS', -14),
            truePeak: entry('dBTP', -3),
            rms: entry('dBFS', -20),
        } as const;
        const preview = {
            integratedLoudness: entry('LUFS', -12.5),
            truePeak: entry('dBTP', -2),
            rms: entry('dBFS', -17),
        } as const;
        const realDeltas = compareAgentScopeMeasurements({
            baseline: {
                integratedLoudness: baseline.integratedLoudness,
                truePeak: baseline.truePeak,
                rms: baseline.rms,
            },
            preview: { integratedLoudness: preview.integratedLoudness, truePeak: preview.truePeak, rms: preview.rms },
        });
        proposeCard({
            gain: 0.7,
            preview: previewOf([{ ...vocalTarget(), baseline, preview, deltas: realDeltas }]),
        });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error(`Expected the real changes to be claimed, got: ${JSON.stringify(claim)}`);
        }
        expect(claim.metrics.map((metric) => [metric.metricId, metric.delta.unit])).toEqual([
            ['integratedLoudness', 'LU'],
            ['truePeak', 'dB'],
            ['rms', 'dB'],
        ]);
    });

    it('does not claim a change whose own unit disagrees with the metric definition', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([
                vocalTarget({
                    baseline: { rms: entry('dBFS', -20), truePeak: entry('dBTP', -3) },
                    preview: { rms: entry('dBFS', -17), truePeak: entry('dBTP', -2) },
                    deltas: {
                        rms: { status: 'compared', delta: 3, unit: 'LU' },
                        truePeak: compared('dBTP', 1),
                    },
                }),
            ]),
        });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error('The metric whose change unit matches is still claimed.');
        }
        expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['truePeak']);
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

    /** What a reload reads: the JSON the store wrote, not the in-memory state. */
    function reloadRunFromStorage(): ReturnType<typeof sanitizeAgentRunState>['runs'][number] | undefined {
        const written = localStorage.getItem('sourdaw-agent-runs');
        if (written === null) {
            throw new Error('The run store wrote nothing.');
        }
        return sanitizeAgentRunState(parse(written)).runs.find((run) => run.runId === RUN_ID);
    }

    it('round-trips a claim over a named section through what the store wrote', () => {
        proposeCard({
            gain: 0.7,
            preview: (bound) => ({
                ...previewOf([vocalTarget()])(bound),
                range: { startBeat: 4, endBeat: 8, sectionId: 'chorus' },
            }),
        });
        const before = audible();
        if (before.status !== 'measured') {
            throw new Error('Expected a measured claim.');
        }
        expect(before.metrics[0]?.range).toEqual({ startBeat: 4, endBeat: 8, sectionId: 'chorus' });
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(before);
    });

    it('round-trips a claim over a bus target unchanged through what the store wrote', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([vocalTarget({ targetId: 'bus-drums', targetKind: 'bus' })]),
        });
        const before = audible();
        if (before.status !== 'measured') {
            throw new Error('Expected a measured claim.');
        }
        expect(before.metrics.every((metric) => metric.targetKind === 'bus')).toBe(true);
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(before);
    });

    it('round-trips a claim over the master target unchanged through what the store wrote', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([vocalTarget({ targetId: 'master', targetKind: 'master' })]),
        });
        const before = audible();
        if (before.status !== 'measured') {
            throw new Error('Expected a measured claim.');
        }
        expect(before.metrics.every((metric) => metric.targetKind === 'master')).toBe(true);
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(before);
    });

    describe('the size of a claim', () => {
        const manyTargets = (count: number) =>
            Array.from({ length: count }, (_, index) => vocalTarget({ targetId: `target-${String(index)}` }));

        it('claims exactly the limit and keeps the run across a write and reload', () => {
            proposeCard({ gain: 0.7, preview: previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS)) });
            const claim = audible();
            if (claim.status !== 'measured') {
                throw new Error(`Expected the claim at the limit, got: ${JSON.stringify(claim)}`);
            }
            expect(claim.metrics).toHaveLength(MAX_AUDIBLE_CLAIM_METRICS);
            persistAgentRunState(readAgentRunState());
            expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(claim);
        });

        it('replaces the too-large reason with the plain no-claim reason on a later unmeasured card', () => {
            proposeCard({ gain: 0.7, preview: previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS + 1)) });
            expect(audible()).toEqual({ status: 'not-claimed', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON });
            proposeCard({ gain: 0.6 });
            expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
        });

        it('claims nothing past the limit, says why, and keeps the run across a write and reload', () => {
            proposeCard({ gain: 0.7, preview: previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS + 1)) });
            expect(audible()).toEqual({ status: 'not-claimed', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON });
            persistAgentRunState(readAgentRunState());
            expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual({
                status: 'not-claimed',
                reason: AUDIBLE_CLAIM_TOO_LARGE_REASON,
            });
        });
    });

    describe('a stored claim the reader refuses', () => {
        type StoredClaim = Record<string, unknown> & { metrics?: Record<string, unknown>[] };
        type Corruption = {
            rule: string;
            base: 'measured' | 'not-claimed';
            edit: (claim: StoredClaim) => void;
        };
        const firstMetric = (claim: StoredClaim): Record<string, unknown> => {
            const [metric] = claim.metrics ?? [];
            if (metric === undefined) {
                throw new Error('Expected a metric to corrupt.');
            }
            return metric;
        };
        const metricRange = (claim: StoredClaim): Record<string, unknown> =>
            firstMetric(claim).range as Record<string, unknown>;
        const metricFigure = (claim: StoredClaim, key: 'baseline' | 'preview' | 'delta'): Record<string, unknown> =>
            firstMetric(claim)[key] as Record<string, unknown>;

        const NON_FINITE = [
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
            ['-Infinity', Number.NEGATIVE_INFINITY],
        ] as const;

        const CORRUPTIONS: Corruption[] = [
            {
                rule: 'a not-claimed claim with no reason',
                base: 'not-claimed',
                edit: (claim) => {
                    delete claim.reason;
                },
            },
            {
                rule: 'a not-claimed claim with an empty reason',
                base: 'not-claimed',
                edit: (claim) => {
                    claim.reason = '';
                },
            },
            {
                rule: 'a status that is neither measured nor not-claimed',
                base: 'measured',
                edit: (claim) => {
                    claim.status = 'unknown';
                },
            },
            {
                rule: 'a measured claim with no revision',
                base: 'measured',
                edit: (claim) => {
                    delete claim.revision;
                },
            },
            {
                rule: 'a measured claim with an empty revision',
                base: 'measured',
                edit: (claim) => {
                    claim.revision = '';
                },
            },
            {
                rule: 'an empty batchContentHash',
                base: 'measured',
                edit: (claim) => {
                    claim.batchContentHash = '';
                },
            },
            {
                rule: 'metrics that are not an array',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = 'not-a-list' as unknown as Record<string, unknown>[];
                },
            },
            {
                rule: 'a targetKind outside master, track and bus',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).targetKind = 'clip';
                },
            },
            {
                rule: 'an empty metricId',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).metricId = '';
                },
            },
            {
                rule: 'a figure with an empty unit',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'baseline').unit = '';
                },
            },
            {
                rule: 'a figure whose value is a string',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'baseline').value = 'loud';
                },
            },
            {
                rule: 'a range whose startBeat is a string',
                base: 'measured',
                edit: (claim) => {
                    metricRange(claim).startBeat = 'zero';
                },
            },
            {
                rule: 'a range whose endBeat is a string',
                base: 'measured',
                edit: (claim) => {
                    metricRange(claim).endBeat = '4';
                },
            },
            {
                rule: 'a range sectionId that is a number',
                base: 'measured',
                edit: (claim) => {
                    metricRange(claim).sectionId = 7;
                },
            },
            {
                rule: 'a range sectionId that is a non-string value with a positive length',
                base: 'measured',
                edit: (claim) => {
                    metricRange(claim).sectionId = ['chorus'];
                },
            },
            {
                rule: 'a range sectionId that is an empty string',
                base: 'measured',
                edit: (claim) => {
                    metricRange(claim).sectionId = '';
                },
            },
            {
                rule: 'a range with no sectionId key',
                base: 'measured',
                edit: (claim) => {
                    delete metricRange(claim).sectionId;
                },
            },
            {
                rule: 'a range with no startBeat',
                base: 'measured',
                edit: (claim) => {
                    delete metricRange(claim).startBeat;
                },
            },
            {
                rule: 'a range with no endBeat',
                base: 'measured',
                edit: (claim) => {
                    delete metricRange(claim).endBeat;
                },
            },
            {
                rule: 'a metric range that is null',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).range = null;
                },
            },
            {
                rule: 'a metric range that is an array',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).range = [];
                },
            },
            {
                rule: 'a metric that is null',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = [null as unknown as Record<string, unknown>];
                },
            },
            {
                rule: 'a metric that is an array',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = [[] as unknown as Record<string, unknown>];
                },
            },
            {
                rule: 'a metric that is an array carrying every field of a valid metric',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = [Object.assign([], firstMetric(claim))];
                },
            },
            {
                rule: 'metrics that are a number',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = 3 as unknown as Record<string, unknown>[];
                },
            },
            {
                rule: 'metrics that are a plain object',
                base: 'measured',
                edit: (claim) => {
                    claim.metrics = { length: 1 } as unknown as Record<string, unknown>[];
                },
            },
            {
                rule: 'a metric with no targetId',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).targetId;
                },
            },
            {
                rule: 'an empty targetId',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).targetId = '';
                },
            },
            {
                rule: 'a metric with no targetKind',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).targetKind;
                },
            },
            {
                rule: 'a metric with no metricId',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).metricId;
                },
            },
            {
                rule: 'a metric with no range',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).range;
                },
            },
            {
                rule: 'a metric with no baseline',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).baseline;
                },
            },
            {
                rule: 'a metric with no preview',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).preview;
                },
            },
            {
                rule: 'a metric with no delta',
                base: 'measured',
                edit: (claim) => {
                    delete firstMetric(claim).delta;
                },
            },
            {
                rule: 'a baseline that is null',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).baseline = null;
                },
            },
            {
                rule: 'a preview that is an array',
                base: 'measured',
                edit: (claim) => {
                    firstMetric(claim).preview = [];
                },
            },
            {
                rule: 'a delta whose value is a string',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'delta').value = 'loud';
                },
            },
            {
                rule: 'a preview whose value is a string',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'preview').value = 'loud';
                },
            },
            {
                rule: 'a figure with no value',
                base: 'measured',
                edit: (claim) => {
                    delete metricFigure(claim, 'baseline').value;
                },
            },
            {
                rule: 'a figure with no unit',
                base: 'measured',
                edit: (claim) => {
                    delete metricFigure(claim, 'preview').unit;
                },
            },
            {
                rule: 'a delta with an empty unit',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'delta').unit = '';
                },
            },
            {
                rule: 'a preview with an empty unit',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'preview').unit = '';
                },
            },
            {
                rule: 'a unit one character over the text bound',
                base: 'measured',
                edit: (claim) => {
                    metricFigure(claim, 'baseline').unit = 'x'.repeat(AGENT_RUN_MAX_TEXT_LENGTH + 1);
                },
            },
            {
                rule: 'a reason one character over the text bound',
                base: 'not-claimed',
                edit: (claim) => {
                    claim.reason = 'x'.repeat(AGENT_RUN_MAX_TEXT_LENGTH + 1);
                },
            },
            {
                rule: 'a revision one character over the text bound',
                base: 'measured',
                edit: (claim) => {
                    claim.revision = 'x'.repeat(AGENT_RUN_MAX_TEXT_LENGTH + 1);
                },
            },
            {
                rule: 'a measured claim with no batchContentHash',
                base: 'measured',
                edit: (claim) => {
                    delete claim.batchContentHash;
                },
            },
            {
                rule: 'a measured claim with no metrics',
                base: 'measured',
                edit: (claim) => {
                    delete claim.metrics;
                },
            },
            {
                rule: 'a status that is missing',
                base: 'measured',
                edit: (claim) => {
                    delete claim.status;
                },
            },
            ...NON_FINITE.flatMap(([label, bad]) => [
                ...(['baseline', 'preview', 'delta'] as const).map((key): Corruption => ({
                    rule: `a ${key} value that is ${label}`,
                    base: 'measured',
                    edit: (claim) => {
                        metricFigure(claim, key).value = bad;
                    },
                })),
                ...(['startBeat', 'endBeat'] as const).map((key): Corruption => ({
                    rule: `a range ${key} that is ${label}`,
                    base: 'measured',
                    edit: (claim) => {
                        metricRange(claim)[key] = bad;
                    },
                })),
            ]),
        ];

        /** How many runs survive a reload of the stored state after `edit` rewrote its audible claim. */
        function survivorsAfter(base: Corruption['base'], edit: (claim: StoredClaim) => void): number {
            if (base === 'measured') {
                proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
            } else {
                proposeCard({ gain: 0.7 });
            }
            const copy = structuredClone(readAgentRunState()) as {
                runs: { plan: { expectedImpact: { audible: StoredClaim } } }[];
            };
            for (const run of copy.runs) {
                edit(run.plan.expectedImpact.audible);
            }
            return sanitizeAgentRunState(copy).runs.length;
        }

        it.each(['measured', 'not-claimed'] as const)('keeps a run whose %s claim is untouched', (base) => {
            expect(survivorsAfter(base, () => undefined)).toBe(1);
        });

        it('drops a run whose plan carries another malformed field, the reference for the rows below', () => {
            proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
            const copy = structuredClone(readAgentRunState()) as {
                runs: { plan: { expectedImpact: Record<string, unknown> } }[];
            };
            for (const run of copy.runs) {
                run.plan.expectedImpact.project = 7;
            }
            expect(sanitizeAgentRunState(copy).runs).toHaveLength(0);
        });

        it.each(CORRUPTIONS.map((row) => [row.rule, row] as const))('drops the run for %s', (_rule, row) => {
            expect(survivorsAfter(row.base, row.edit)).toBe(0);
        });
    });

    it('drops a run whose persisted measured claim carries more metrics than the limit', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]) });
        const persisted = (metricCount: number): number => {
            const copy = structuredClone(readAgentRunState()) as {
                runs: { plan: { expectedImpact: { audible: { metrics: unknown[] } } } }[];
            };
            for (const run of copy.runs) {
                const [first] = run.plan.expectedImpact.audible.metrics;
                run.plan.expectedImpact.audible.metrics = Array.from({ length: metricCount }, () => first);
            }
            localStorage.setItem('sourdaw-agent-runs', stringify(copy));
            return reloadRunFromStorage() === undefined ? 0 : 1;
        };
        expect(persisted(MAX_AUDIBLE_CLAIM_METRICS)).toBe(1);
        expect(persisted(MAX_AUDIBLE_CLAIM_METRICS + 1)).toBe(0);
    });
});
