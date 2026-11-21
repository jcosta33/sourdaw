import { parse, stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { compareAgentScopeMeasurements } from '#/modules/AudioAnalysis/useCases';
import { executeAppAction, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { AGENT_RUN_MAX_TEXT_LENGTH, MAX_AUDIBLE_CLAIM_METRICS, MAX_AUDIBLE_PREDICTIONS } from '../../models/AgentRun';
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
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import {
    AUDIBLE_CLAIM_TOO_LARGE_REASON,
    NO_AUDIBLE_CLAIM_REASON,
    UNBOUND_PREDICTION_REASON,
} from '../deriveMeasuredAudibleImpact';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { readPerceptualConstraintGoals } from '../perceptualConstraints/readPerceptualConstraintGoals';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

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

type FigureUnit = 'dBFS' | 'dBTP' | 'LUFS' | 'dB' | 'hertz';

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
    /** The gain the batch expects the track to hold when it runs; a card that is only persisted never needs it. */
    expectedGain?: number;
    preview?: (bound: { revision: string; batchContentHash: string }) => MeasuredPreview;
    /** A preview held only by the metric-goal proofs, as a vibe-run batch card holds it. */
    proofPreviews?: readonly ((bound: { revision: string; batchContentHash: string }) => MeasuredPreview)[];
    foreignHash?: boolean;
    /** An approval compiled with no metric-goal state at all, so the card persists with none. */
    withoutGoalState?: boolean;
    /** Frozen metric goals of a perceptual or comparative request, bound to the batch the card persists. */
    goals?: {
        kind: 'perceptual' | 'comparative';
        goals: readonly MetricGoal[];
        proofPreviews?: readonly ((bound: { revision: string; batchContentHash: string }) => MeasuredPreview)[];
    };
}): Card {
    const revision = captureProjectRevision();
    const actions = [
        {
            type: 'setTrackGain' as const,
            payload: { trackId: 'vocal', gain: input.gain, expectedGain: input.expectedGain ?? 1 },
        },
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
    let metricGoalState: ReturnType<typeof goalState> | ReturnType<typeof proofOnlyState>;
    if (input.goals === undefined) {
        metricGoalState = proofOnlyState(
            compiled.commandBatch,
            input.proofPreviews?.map((build) => build({ revision, batchContentHash }))
        );
    } else {
        metricGoalState = goalState(compiled.commandBatch, {
            kind: input.goals.kind,
            goals: input.goals.goals,
            previews: input.goals.proofPreviews?.map((build) => build({ revision, batchContentHash })) ?? [],
        });
    }
    let approval = compiled.agentApproval;
    let persistedGoalState = metricGoalState;
    if (input.withoutGoalState === true) {
        approval = { ...approval, metricGoalState: undefined };
        persistedGoalState = undefined;
    }
    const confirmationId = persistPromptActionConfirmation({
        runId: RUN_ID,
        prompt: 'Set the vocal gain',
        assistantMessageId: ASSISTANT_ID,
        actions,
        actionLabels: ['setTrackGain'],
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: approval,
        affectedIds: ['vocal'],
        protectedUnchanged: [],
        metricGoalState: persistedGoalState,
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

function withProofs(state: object, previews: readonly MeasuredPreview[]): string {
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

function proofOnlyState(
    commandBatch: ReturnType<typeof compileAgentActionExecution>['commandBatch'],
    previews: readonly MeasuredPreview[] | undefined
): string | undefined {
    if (previews === undefined) {
        return undefined;
    }
    return withProofs(JSON.parse(configuredLiteralMetricState(commandBatch)) as object, previews);
}

/** The literal fixture's state with its authority replaced by one stating `goals`, bound to the whole batch. */
function goalState(
    commandBatch: ReturnType<typeof compileAgentActionExecution>['commandBatch'],
    input: { kind: 'perceptual' | 'comparative'; goals: readonly MetricGoal[]; previews: readonly MeasuredPreview[] }
): string {
    const literal = metricGoalStateCodec(configuredLiteralMetricState(commandBatch));
    const authority = literal?.authorities[0];
    if (literal === null || authority === undefined) {
        throw new Error('Expected the literal fixture state.');
    }
    const { envelope } = parseBatch(commandBatch);
    const state: MetricGoalState = {
        ...literal,
        authorities: [{ ...authority, kind: input.kind, goals: input.goals }],
        steps: [
            {
                stepId: 'overall',
                commandCount: envelope.commands.length,
                operationTypes: envelope.commands.map((command) => command.operation),
                recipePrefixHash: null,
            },
        ],
        proofs: [],
        binding: null,
    };
    return withProofs(bindMetricGoalsToBatch({ state, commandBatch }), input.previews);
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

/** What a reload reads: the JSON the store wrote, not the in-memory state. */
function reloadRunFromStorage(): ReturnType<typeof sanitizeAgentRunState>['runs'][number] | undefined {
    const written = localStorage.getItem('sourdaw-agent-runs');
    if (written === null) {
        throw new Error('The run store wrote nothing.');
    }
    return sanitizeAgentRunState(parse(written)).runs.find((run) => run.runId === RUN_ID);
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

    it.each([
        [
            'every compared metric held',
            vocalTarget({
                preview: {
                    rms: entry('dBFS', -20.123456789),
                    truePeak: entry('dBTP', -3.25),
                    crestFactor: entry('dB', 9.5),
                },
                deltas: { rms: compared('dBFS', 0), truePeak: compared('dBTP', 0) },
            }),
        ],
        [
            'every entry is incomparable',
            vocalTarget({
                deltas: {
                    rms: { status: 'incomparable', reason: 'The rms is not comparable here.' },
                    truePeak: { status: 'incomparable', reason: 'The true peak is not comparable here.' },
                },
            }),
        ],
    ])('says the measured preview moved no figure when %s', (_name, target) => {
        proposeCard({ gain: 0.7, preview: previewOf([target]) });
        expect(audible()).toEqual({
            status: 'not-claimed',
            reason: 'The measured preview moved no figure, so the plan claims no audible change.',
        });
    });

    it('says the measured preview moved no figure when only the metric-goal proofs measured the batch', () => {
        proposeCard({
            gain: 0.7,
            proofPreviews: [previewOf([vocalTarget({ deltas: { rms: compared('dBFS', 0) } })])],
        });
        expect(audible()).toEqual({
            status: 'not-claimed',
            reason: 'The measured preview moved no figure, so the plan claims no audible change.',
        });
    });

    it('does not claim a figure whose baseline fails the unit projection while the preview passes', () => {
        proposeCard({
            gain: 0.7,
            preview: previewOf([
                vocalTarget({
                    baseline: { rms: entry('LUFS', -20), truePeak: entry('dBTP', -3), crestFactor: entry('dB', 9) },
                    preview: { rms: entry('dBFS', -17), truePeak: entry('dBTP', -2), crestFactor: entry('dB', 8) },
                    deltas: {
                        rms: compared('dBFS', 3),
                        truePeak: compared('dBTP', 1),
                        crestFactor: compared('dB', -1),
                    },
                }),
            ]),
        });
        const claim = audible();
        if (claim.status !== 'measured') {
            throw new Error('The metrics whose baseline matches are still claimed.');
        }
        expect(claim.metrics.map((metric) => metric.metricId)).toEqual(['truePeak', 'crestFactor']);
    });

    describe('a card whose own preview did not bind the persisted batch', () => {
        const proofOfMovedRms = [previewOf([vocalTarget()])];

        it('does not list the figures of proofs the card does not display', () => {
            proposeCard({
                gain: 0.7,
                preview: (bound) => ({ ...previewOf([vocalTarget()])(bound), batchContentHash: 'another-batch' }),
                proofPreviews: proofOfMovedRms,
            });
            expect(audible()).toEqual({
                status: 'not-claimed',
                reason: 'The proofs measured figures the approval card does not show, so the plan does not list them.',
            });
        });

        it('claims nothing more than the plain no-claim reason when no proof is bound either', () => {
            proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]), foreignHash: true });
            expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
        });

        it('still claims from the proofs of a card that was offered no preview at all', () => {
            proposeCard({ gain: 0.7, proofPreviews: proofOfMovedRms });
            expect(audible().status).toBe('measured');
        });
    });

    describe('the plan revision across the claim writes', () => {
        it.each([
            ['a claim', { preview: previewOf([vocalTarget()]) }],
            ['a goal state and no claim', { proofPreviews: [] }],
            ['no goal state and no claim', {}],
        ])('is the revision of the card persisted with %s', async (_name, measurement) => {
            const planned = captureProjectRevision();
            await executeAppAction({ type: 'renameTrack', payload: { trackId: 'vocal', name: 'Renamed Vocal' } });
            const revision = captureProjectRevision();
            expect(revision).not.toBe(planned);
            proposeCard({ gain: 0.7, ...measurement });
            expect(agentRunLifecycle.get(RUN_ID)?.plan?.revision).toBe(revision);
        });
    });

    it('replaces the no-figure-moved reason with the plain no-claim reason on a later unmeasured card', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget({ deltas: { rms: compared('dBFS', 0) } })]) });
        expect(audible().status).toBe('not-claimed');
        expect(audible()).not.toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
        proposeCard({ gain: 0.6 });
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
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

    it('clears the claim of an earlier batch when a goalless card is re-previewed after the project moved', async () => {
        const liveGain = trackStore.value?.tracks.find((track) => track.id === 'vocal')?.gain;
        const first = proposeCard({
            gain: 0.7,
            expectedGain: liveGain,
            preview: previewOf([vocalTarget()]),
            proofPreviews: [],
        });
        expect(audible().status).toBe('measured');
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'master', name: 'Main Out' } });
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'waiting-for-approval' });

        const result = await reproposePendingChatActions({ confirmationId: first.confirmationId });

        expect(result).toMatchObject({ status: 'reproposed' });
        const reproposed = result.status === 'reproposed' ? getPendingActionConfirmation(result.confirmationId) : null;
        expect(reproposed?.approvalSnapshot.measuredPreview).toBeUndefined();
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
    });

    it('clears the claim of an earlier batch when a card with no goal state and no claim is persisted', () => {
        proposeCard({ gain: 0.7, preview: previewOf([vocalTarget()]), withoutGoalState: true });
        expect(audible().status).toBe('measured');
        proposeCard({ gain: 0.6, withoutGoalState: true });
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
    });

    it('writes nothing for a card with no goal state and no claim when the plan already claims none', () => {
        proposeCard({ gain: 0.7, withoutGoalState: true });
        const before = agentRunLifecycle.get(RUN_ID)?.plan;
        proposeCard({ gain: 0.6, withoutGoalState: true });
        expect(agentRunLifecycle.get(RUN_ID)?.plan).toEqual(before);
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

        it('says only that the figures are too many to list, since a vibe-run batch card shows none', () => {
            proposeCard({
                gain: 0.7,
                proofPreviews: [previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS + 1))],
            });
            expect(audible()).toEqual({
                status: 'not-claimed',
                reason: 'The measurement moved more figures than a plan can list.',
            });
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

describe('the plan’s predicted audible claim', () => {
    const catalog = getMixRecipeCatalog();

    /** A frozen spectral centroid goal on the vocal, taken from the catalog recipe that promises that direction. */
    function centroidGoal(direction: 'increase' | 'decrease', goalId = `vocal-centroid-${direction}`): MetricGoal {
        const recipe = catalog.recipes.find(
            (entry) =>
                entry.origin === undefined &&
                entry.metrics.some(
                    (metric) =>
                        metric.metric === 'spectralCentroid' &&
                        metric.direction === direction &&
                        metric.band === undefined
                )
        );
        const expectationIndex =
            recipe?.metrics.findIndex(
                (metric) =>
                    metric.metric === 'spectralCentroid' && metric.direction === direction && metric.band === undefined
            ) ?? -1;
        if (recipe === undefined || expectationIndex < 0) {
            throw new Error(`The catalog holds no recipe promising a spectral centroid ${direction}.`);
        }
        return {
            goalId,
            stepId: 'overall',
            metricId: 'spectralCentroid',
            band: null,
            targetIds: ['vocal'],
            referenceTargetIds: [],
            range: { startBeat: 0, endBeat: 4, sectionId: null },
            relation: direction,
            targetValue: null,
            tolerance: 0,
            source: {
                kind: 'recipe',
                recipeId: recipe.id,
                catalogVersion: catalog.version,
                recipeDigest: digest(recipe),
                expectationIndex,
            },
        };
    }

    const loudnessOrderingGoal: MetricGoal = {
        goalId: 'vocal-louder-than-master',
        stepId: 'overall',
        metricId: 'integratedLoudness',
        band: null,
        targetIds: ['vocal'],
        referenceTargetIds: ['master'],
        range: { startBeat: 0, endBeat: 4, sectionId: null },
        relation: 'greater-than-current',
        targetValue: null,
        tolerance: 0,
        source: { kind: 'policy', policyId: 'integrated-loudness-comparison-v1' },
    };

    /** The vocal's spectral centroid before and after, with the change the real comparison reports. */
    function centroidTarget(baselineHz: number, previewHz: number): MeasuredPreviewTarget {
        const change = compareAgentScopeMeasurements({
            baseline: { spectralCentroid: entry('hertz', baselineHz) },
            preview: { spectralCentroid: entry('hertz', previewHz) },
        }).spectralCentroid;
        if (change === undefined) {
            throw new Error('The comparison reported nothing.');
        }
        return {
            targetId: 'vocal',
            targetKind: 'track',
            baseline: { spectralCentroid: entry('hertz', baselineHz) },
            preview: { spectralCentroid: entry('hertz', previewHz) },
            deltas: { spectralCentroid: change },
        };
    }

    function predicted(): Extract<AudibleClaim, { status: 'predicted' }> {
        const claim = audible();
        if (claim.status !== 'predicted') {
            throw new Error(`Expected a predicted claim, got: ${JSON.stringify(claim)}`);
        }
        return claim;
    }

    const brighter = centroidGoal('increase');

    it('states the frozen goals as predictions bound to the batch, before any preview is measured', () => {
        const card = proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } });
        const claim = predicted();
        expect(claim).toEqual({
            status: 'predicted',
            kind: 'perceptual',
            revision: captureProjectRevision(),
            batchContentHash: digestCommandBatchContent(card.envelope),
            predictions: [{ ...brighter, outcome: null }],
            verification: null,
            observed: { status: 'listed', metrics: [] },
        });
        const state = metricGoalStateCodec(
            getPendingActionConfirmation(card.confirmationId)?.approvalSnapshot.metricGoalState
        );
        expect(claim.batchContentHash).toBe(state?.binding?.contentHash);
        expect(claim.revision).toBe(state?.binding?.revision);
    });

    it('shows each prediction beside its measured figures when the preview satisfies the goals', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } });
        const before = predicted();
        proposeCard({
            gain: 0.7,
            goals: {
                kind: 'perceptual',
                goals: [brighter],
                proofPreviews: [previewOf([centroidTarget(1000, 1400)])],
            },
        });
        const claim = predicted();
        expect(Object.keys(claim).sort()).toEqual(Object.keys(before).sort());
        expect(claim.verification).toMatchObject({ status: 'verified', failure: null });
        expect(claim.predictions).toEqual([
            {
                ...brighter,
                outcome: { baseline: [1000], observed: [1400], reference: [], unit: 'hertz', status: 'verified' },
            },
        ]);
        // The observed change is listed apart from the prediction and is the measurement's own figures.
        expect(claim.observed).toEqual({
            status: 'listed',
            metrics: [
                {
                    targetId: 'vocal',
                    targetKind: 'track',
                    range: { startBeat: 0, endBeat: 4, sectionId: null },
                    metricId: 'spectralCentroid',
                    baseline: { value: 1000, unit: 'hertz' },
                    preview: { value: 1400, unit: 'hertz' },
                    delta: { value: 400, unit: 'hertz' },
                },
            ],
        });
    });

    it('blocks a preview that contradicts the prediction, and the card stays visible with Confirm refused', () => {
        const card = proposeCard({
            gain: 0.7,
            preview: previewOf([centroidTarget(1000, 800)]),
            goals: {
                kind: 'perceptual',
                goals: [brighter],
                proofPreviews: [previewOf([centroidTarget(1000, 800)])],
            },
        });
        const claim = predicted();
        expect(claim.verification).toMatchObject({ status: 'blocked', failure: 'out-of-tolerance' });
        expect(claim.predictions[0]?.outcome).toEqual({
            baseline: [1000],
            observed: [800],
            reference: [],
            unit: 'hertz',
            status: 'blocked',
        });
        const view = getAgentApprovalView({ confirmationId: card.confirmationId });
        expect(view?.status).toBe('proposed');
        expect(view?.measuredPreview).not.toBeNull();
        expect(view?.canConfirm).toBe(false);
        expect(view?.metricGoals).toMatchObject({
            status: 'blocked',
            failure: claim.verification?.failure,
            reason: claim.verification?.reason,
        });
    });

    it('blocks goals that contradict each other as contradictory, with every prediction unmeasured', () => {
        const card = proposeCard({
            gain: 0.7,
            goals: {
                kind: 'perceptual',
                goals: [brighter, centroidGoal('decrease')],
                proofPreviews: [previewOf([centroidTarget(1000, 1400)])],
            },
        });
        const claim = predicted();
        expect(claim.verification).toMatchObject({ status: 'blocked', failure: 'contradictory' });
        expect(claim.predictions.map((prediction) => prediction.goalId)).toEqual([
            'vocal-centroid-increase',
            'vocal-centroid-decrease',
        ]);
        expect(claim.predictions.map((prediction) => prediction.outcome?.status)).toEqual(['blocked', 'blocked']);
        const view = getAgentApprovalView({ confirmationId: card.confirmationId });
        expect(view?.canConfirm).toBe(false);
        expect(view?.metricGoals.failure).toBe('contradictory');
    });

    it('carries the reference targets and the comparative relation of a comparative request', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'comparative', goals: [loudnessOrderingGoal] } });
        const claim = predicted();
        expect(claim.kind).toBe('comparative');
        expect(claim.predictions).toEqual([{ ...loudnessOrderingGoal, outcome: null }]);
        expect(claim.predictions[0]?.referenceTargetIds).toEqual(['master']);
        expect(claim.predictions[0]?.relation).toBe('greater-than-current');
        expect(claim.verification).toBeNull();
    });

    it('lists the goals of a mixed request once, as comparative', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'comparative', goals: [loudnessOrderingGoal, brighter] } });
        const claim = predicted();
        expect(claim.kind).toBe('comparative');
        expect(claim.predictions.map((prediction) => prediction.goalId)).toEqual([
            'vocal-louder-than-master',
            'vocal-centroid-increase',
        ]);
    });

    it('claims nothing audible for a literal plan that states no goal', () => {
        proposeCard({ gain: 0.7, proofPreviews: [] });
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
    });

    it('keeps the observed-only measured claim for a goalless plan with a bound preview', () => {
        proposeCard({ gain: 0.7, proofPreviews: [previewOf([vocalTarget()])] });
        expect(audible().status).toBe('measured');
    });

    it('never verifies against a preview of another batch', () => {
        proposeCard({
            gain: 0.7,
            foreignHash: true,
            preview: previewOf([centroidTarget(1000, 1400)]),
            goals: { kind: 'perceptual', goals: [brighter], proofPreviews: [previewOf([centroidTarget(1000, 1400)])] },
        });
        const claim = predicted();
        expect(claim.verification).toBeNull();
        expect(claim.predictions.map((prediction) => prediction.outcome)).toEqual([null]);
        expect(claim.observed).toEqual({ status: 'listed', metrics: [] });
    });

    it('never verifies against a preview of another revision', () => {
        proposeCard({
            gain: 0.7,
            goals: {
                kind: 'perceptual',
                goals: [brighter],
                proofPreviews: [
                    (bound) => ({ ...previewOf([centroidTarget(1000, 1400)])(bound), revision: 'another-revision' }),
                ],
            },
        });
        const claim = predicted();
        expect(claim.verification).toBeNull();
        expect(claim.predictions.map((prediction) => prediction.outcome)).toEqual([null]);
    });

    it('keeps the predictions but resets the verification when the card is rebound to a new binding', () => {
        proposeCard({
            gain: 0.7,
            goals: { kind: 'perceptual', goals: [brighter], proofPreviews: [previewOf([centroidTarget(1000, 1400)])] },
        });
        expect(predicted().verification?.status).toBe('verified');
        const run = agentRunLifecycle.get(RUN_ID);
        const state = metricGoalStateCodec(run?.plan?.metricGoalState);
        if (run === null || state?.binding === null || state === null) {
            throw new Error('Expected the bound goal state.');
        }
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'waiting-for-approval' });
        const rebound: MetricGoalState = {
            ...state,
            proofs: [],
            binding: { ...state.binding, contentHash: 'rebound-batch-hash', revision: 'rebound-revision' },
        };
        expect(
            agentRunLifecycle.rebindMetricGoalState({
                runId: RUN_ID,
                expectedMetricGoalState: run.plan?.metricGoalState,
                metricGoalState: JSON.stringify(rebound),
                revision: 'rebound-revision',
            })
        ).toBe(true);
        expect(predicted()).toEqual({
            status: 'predicted',
            kind: 'perceptual',
            revision: 'rebound-revision',
            batchContentHash: 'rebound-batch-hash',
            predictions: [{ ...brighter, outcome: null }],
            verification: null,
            observed: { status: 'listed', metrics: [] },
        });
    });

    it('says why nothing is predicted when the goals are bound to no batch', () => {
        const run = agentRunLifecycle.get(RUN_ID);
        if (run?.plan === null || run === null) {
            throw new Error('Expected the run plan.');
        }
        const unbound: MetricGoalState = {
            schemaVersion: 1,
            authorities: [],
            steps: [],
            proofs: [],
            binding: null,
        };
        const literal = metricGoalStateCodec(
            configuredLiteralMetricState(
                compileAgentActionExecution({
                    actions: [{ type: 'setTrackGain', payload: { trackId: 'vocal', gain: 0.7, expectedGain: 1 } }],
                    actionLabels: ['setTrackGain'],
                    context: getProjectContext(),
                    group: { groupId: 'unbound', groupLabel: 'Unbound' },
                    intent: 'Set the vocal gain',
                    projectRevision: captureProjectRevision(),
                    requiresConfirmation: true,
                    runId: RUN_ID,
                }).commandBatch
            )
        );
        const authority = literal?.authorities[0];
        if (authority === undefined) {
            throw new Error('Expected the literal fixture authority.');
        }
        agentRunLifecycle.recordPlan({
            runId: RUN_ID,
            summary: run.plan.summary,
            commandIds: [],
            serializedBatchIdentity: null,
            revision: captureProjectRevision(),
            scope: run.scope,
            grants: run.grants,
            budgets: run.budgets,
            plan: {
                ...run.plan,
                metricGoalState: JSON.stringify({
                    ...unbound,
                    authorities: [{ ...authority, kind: 'perceptual', goals: [brighter] }],
                }),
            },
        });
        expect(audible()).toEqual({ status: 'not-claimed', reason: UNBOUND_PREDICTION_REASON });
    });

    it('does not let a later card with no goal state inherit the first card’s predictions', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } });
        expect(audible().status).toBe('predicted');
        proposeCard({ gain: 0.6 });
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
    });

    it('does not restate the earlier batch’s predictions when a write supplies no goal state', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } });
        expect(audible().status).toBe('predicted');
        const run = agentRunLifecycle.get(RUN_ID);
        if (run?.plan === null || run === null) {
            throw new Error('Expected the run plan.');
        }
        const { metricGoalState: carried, ...withoutState } = run.plan;
        expect(carried).toBeDefined();
        agentRunLifecycle.recordPlan({
            runId: RUN_ID,
            summary: run.plan.summary,
            commandIds: [],
            serializedBatchIdentity: null,
            revision: captureProjectRevision(),
            scope: run.scope,
            grants: run.grants,
            budgets: run.budgets,
            plan: withoutState,
        });
        // The state field is still carried; the claim is not derived from it.
        expect(agentRunLifecycle.get(RUN_ID)?.plan?.metricGoalState).toBe(carried);
        expect(audible()).toEqual({ status: 'not-claimed', reason: NO_AUDIBLE_CLAIM_REASON });
    });

    it('keeps both predictions, and the run across a reload, when two authorities mint the same goal id', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } });
        const run = agentRunLifecycle.get(RUN_ID);
        const state = metricGoalStateCodec(run?.plan?.metricGoalState);
        const authority = state?.authorities[0];
        if (run?.plan === null || run === null || state === null || authority === undefined) {
            throw new Error('Expected the bound goal state.');
        }
        agentRunLifecycle.recordPlan({
            runId: RUN_ID,
            summary: run.plan.summary,
            commandIds: [],
            serializedBatchIdentity: null,
            revision: captureProjectRevision(),
            scope: run.scope,
            grants: run.grants,
            budgets: run.budgets,
            plan: {
                ...run.plan,
                metricGoalState: JSON.stringify({
                    ...state,
                    authorities: [authority, { ...authority, authorityId: 'second-authority' }],
                }),
            },
        });
        const claim = predicted();
        expect(claim.predictions.map((prediction) => prediction.goalId)).toEqual([brighter.goalId, brighter.goalId]);
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(claim);
    });

    describe('the size of the observed list', () => {
        const manyTargets = (count: number) =>
            Array.from({ length: count }, (_, index) => vocalTarget({ targetId: `target-${String(index)}` }));

        it('lists exactly the limit beside the predictions', () => {
            proposeCard({
                gain: 0.7,
                goals: {
                    kind: 'perceptual',
                    goals: [brighter],
                    proofPreviews: [previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS))],
                },
            });
            const claim = predicted();
            expect(claim.observed.status === 'listed' && claim.observed.metrics).toHaveLength(
                MAX_AUDIBLE_CLAIM_METRICS
            );
        });

        it('marks the list omitted past the limit and still claims the predictions', () => {
            proposeCard({
                gain: 0.7,
                goals: {
                    kind: 'perceptual',
                    goals: [brighter],
                    proofPreviews: [previewOf(manyTargets(MAX_AUDIBLE_CLAIM_METRICS + 1))],
                },
            });
            const claim = predicted();
            expect(claim.observed).toEqual({ status: 'omitted', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON });
            expect(claim.predictions.map((prediction) => prediction.goalId)).toEqual([brighter.goalId]);
            persistAgentRunState(readAgentRunState());
            expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(claim);
        });
    });

    it('keeps a measured constraint hold and an unsupported clause across a reload', () => {
        const goals = readPerceptualConstraintGoals(
            {
                constraints: [
                    {
                        constraintId: 'loudness-held-v1',
                        clause: 'keep the loudness',
                        scope: { kind: 'tracks', trackIds: ['vocal'] },
                        protection: { kind: 'measured' },
                    },
                ],
                unsupported: [
                    {
                        constraintId: 'unsupported',
                        clause: 'keep the vocal intimate',
                        reason: 'No measurement verifies it.',
                    },
                ],
            },
            getProjectContext()
        );
        expect(goals.map((goal) => goal.source)).toEqual([
            { kind: 'constraint', constraintId: 'loudness-held-v1', clause: 'keep the loudness' },
            { kind: 'constraint', constraintId: 'unsupported', clause: 'keep the vocal intimate' },
        ]);
        proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals } });
        const claim = predicted();
        expect(claim.predictions.map((prediction) => prediction.source)).toEqual(goals.map((goal) => goal.source));
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(claim);
    });

    it('keeps a policy-sourced comparative goal across a reload', () => {
        proposeCard({ gain: 0.7, goals: { kind: 'comparative', goals: [loudnessOrderingGoal] } });
        const claim = predicted();
        expect(claim.predictions[0]?.source).toEqual({ kind: 'policy', policyId: 'integrated-loudness-comparison-v1' });
        persistAgentRunState(readAgentRunState());
        expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(claim);
    });

    describe('through the store', () => {
        const rows = {
            unverified: () => proposeCard({ gain: 0.7, goals: { kind: 'perceptual', goals: [brighter] } }),
            verified: () =>
                proposeCard({
                    gain: 0.7,
                    goals: {
                        kind: 'perceptual',
                        goals: [brighter],
                        proofPreviews: [previewOf([centroidTarget(1000, 1400)])],
                    },
                }),
            blocked: () =>
                proposeCard({
                    gain: 0.7,
                    goals: {
                        kind: 'perceptual',
                        goals: [brighter],
                        proofPreviews: [previewOf([centroidTarget(1000, 800)])],
                    },
                }),
        } as const;

        it.each(['unverified', 'verified', 'blocked'] as const)('round-trips a %s claim unchanged', (row) => {
            rows[row]();
            const before = predicted();
            persistAgentRunState(readAgentRunState());
            expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(before);
        });

        it.each(['measured', 'not-claimed'] as const)('still loads a stored %s claim unchanged', (status) => {
            proposeCard(status === 'measured' ? { gain: 0.7, preview: previewOf([vocalTarget()]) } : { gain: 0.7 });
            const before = audible();
            expect(before.status).toBe(status);
            persistAgentRunState(readAgentRunState());
            expect(reloadRunFromStorage()?.plan?.expectedImpact.audible).toEqual(before);
        });

        type StoredPredicted = {
            predictions: Record<string, unknown>[];
            verification: Record<string, unknown> | null;
            observed?: Record<string, unknown>;
        } & Record<string, unknown>;

        const first = (claim: StoredPredicted): Record<string, unknown> => {
            const [prediction] = claim.predictions;
            if (prediction === undefined) {
                throw new Error('Expected a prediction to corrupt.');
            }
            return prediction;
        };
        const outcomeOf = (claim: StoredPredicted): Record<string, unknown> =>
            first(claim).outcome as Record<string, unknown>;

        const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

        const CORRUPTIONS: { rule: string; base: keyof typeof rows; edit: (claim: StoredPredicted) => void }[] = [
            {
                rule: 'no predictions',
                base: 'unverified',
                edit: (claim) => {
                    claim.predictions = [];
                },
            },
            {
                rule: 'more predictions than the ceiling',
                base: 'unverified',
                edit: (claim) => {
                    claim.predictions = Array.from({ length: MAX_AUDIBLE_PREDICTIONS + 1 }, (_, index) => ({
                        ...first(claim),
                        goalId: `goal-${String(index)}`,
                    }));
                },
            },
            {
                rule: 'an outcome while no verification exists',
                base: 'unverified',
                edit: (claim) => {
                    first(claim).outcome = { baseline: [], observed: [], reference: [], unit: null, status: 'blocked' };
                },
            },
            {
                rule: 'a verification with no outcome for a prediction',
                base: 'verified',
                edit: (claim) => {
                    first(claim).outcome = null;
                },
            },
            {
                rule: 'a verified verdict over a blocked outcome',
                base: 'verified',
                edit: (claim) => {
                    outcomeOf(claim).status = 'blocked';
                },
            },
            {
                rule: 'a verified verdict that names a failure',
                base: 'verified',
                edit: (claim) => {
                    claim.verification = { ...claim.verification, failure: 'missing' };
                },
            },
            {
                rule: 'a blocked verdict that names no failure',
                base: 'blocked',
                edit: (claim) => {
                    claim.verification = { ...claim.verification, failure: null };
                },
            },
            {
                rule: 'a failure that is not one the evaluation reports',
                base: 'blocked',
                edit: (claim) => {
                    claim.verification = { ...claim.verification, failure: 'unlikely' };
                },
            },
            {
                rule: 'a relation the goals do not define',
                base: 'unverified',
                edit: (claim) => {
                    first(claim).relation = 'louder';
                },
            },
            {
                rule: 'a source kind the goals do not define',
                base: 'unverified',
                edit: (claim) => {
                    first(claim).source = { kind: 'guess' };
                },
            },
            {
                rule: 'a kind that is neither perceptual nor comparative',
                base: 'unverified',
                edit: (claim) => {
                    claim.kind = 'literal';
                },
            },
            {
                rule: 'an observed list that is neither listed nor omitted',
                base: 'unverified',
                edit: (claim) => {
                    claim.observed = { status: 'maybe' };
                },
            },
            {
                rule: 'a missing observed list',
                base: 'unverified',
                edit: (claim) => {
                    delete claim.observed;
                },
            },
            ...NON_FINITE.flatMap((bad) => [
                {
                    rule: `an outcome figure that is ${String(bad)}`,
                    base: 'verified' as const,
                    edit: (claim: StoredPredicted) => {
                        outcomeOf(claim).observed = [bad];
                    },
                },
                {
                    rule: `a tolerance that is ${String(bad)}`,
                    base: 'unverified' as const,
                    edit: (claim: StoredPredicted) => {
                        first(claim).tolerance = bad;
                    },
                },
            ]),
        ];

        function survivorsAfter(base: keyof typeof rows, edit: (claim: StoredPredicted) => void): number {
            rows[base]();
            const copy = structuredClone(readAgentRunState()) as {
                runs: { plan: { expectedImpact: { audible: StoredPredicted } } }[];
            };
            for (const run of copy.runs) {
                edit(run.plan.expectedImpact.audible);
            }
            return sanitizeAgentRunState(copy).runs.length;
        }

        it.each(['unverified', 'verified', 'blocked'] as const)('keeps a run whose %s claim is untouched', (base) => {
            expect(survivorsAfter(base, () => undefined)).toBe(1);
        });

        it('keeps a run whose predictions sit exactly at the ceiling', () => {
            expect(
                survivorsAfter('unverified', (claim) => {
                    claim.predictions = Array.from({ length: MAX_AUDIBLE_PREDICTIONS }, (_, index) => ({
                        ...first(claim),
                        goalId: `goal-${String(index)}`,
                    }));
                })
            ).toBe(1);
        });

        it.each(CORRUPTIONS.map((row) => [row.rule, row] as const))('drops the run for %s', (_rule, row) => {
            expect(survivorsAfter(row.base, row.edit)).toBe(0);
        });
    });
});
