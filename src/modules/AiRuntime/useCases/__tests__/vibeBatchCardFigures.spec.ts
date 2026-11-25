import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type MeasuredMetricEntry } from '../../models/MeasuredPreview';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from '../metricGoalContractTypes';
import { OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { describeVibeBatchCard } from '../vibeRun/describeVibeBatchCard';
import { describeVibeRunSummary } from '../vibeRun/describeVibeRunSummary';
import { readVibeBatchRecipeGoals } from '../vibeRun/readVibeBatchRecipeGoals';

import { configureMetricGoalProject, resetMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

const RUN_ID = 'batch-card-run';
const TARGET_ID = 'track-kick';
const RANGE = { startBeat: 0, endBeat: 4, sectionId: null };
const CARD_LINE = 'Fresh approval preview on ';

type Reading = { baseline: number; preview: number };
/** What one measured preview reads: its metrics' figures, measured at the batch's end or at one step's prefix. */
type PreviewFigures = Readonly<Record<string, Reading>>;
/** One recipe's criterion kept in the frozen goals; the batch's other criteria are left out so each case is small. */
type Kept = { recipeId: string; metricId: string };

function batchOf(recipeIds: string[]): ScheduledVibeRunBatch {
    return {
        id: 'batch-card-batch',
        ordinal: 1,
        targetIds: [TARGET_ID],
        targets: [{ targetId: TARGET_ID, recipeIds, expectedDeltas: [], commandCount: recipeIds.length }],
        commandCount: recipeIds.length,
        objective: { descriptors: ['warm'], role: 'drums' },
    };
}

function readGoals(batch: ScheduledVibeRunBatch, kept: Kept[]): MetricGoal[] {
    const read = readVibeBatchRecipeGoals({ batch, catalog: getMixRecipeCatalog(), range: RANGE });
    if (read.status !== 'read') {
        throw new Error(read.reason);
    }
    return kept.map(({ recipeId, metricId }) => {
        const goal = read.goals.find(
            (entry) =>
                entry.source.kind === 'recipe' && entry.source.recipeId === recipeId && entry.metricId === metricId
        );
        if (goal === undefined) {
            throw new Error(`No ${metricId} goal for ${recipeId}.`);
        }
        return goal;
    });
}

function entry(metricId: string, value: number): MeasuredMetricEntry {
    const unit = Object.entries(OBJECTIVE_METRIC_UNITS).find(([id]) => id === metricId)?.[1];
    if (unit === undefined) {
        throw new Error(`No unit for ${metricId}.`);
    }
    return { status: 'measured', metricVersion: 1, unit, value, confidence: 'exact' };
}

function compileBatch(commandCount: number) {
    return compileAgentActionExecution({
        actions: Array.from({ length: commandCount }, (_, index) => ({
            type: 'setDeviceParameter' as const,
            payload: { deviceId: 'kick-trim', paramId: 'gain-level', value: -1 - index },
        })),
        actionLabels: Array.from({ length: commandCount }, () => 'setDeviceParameter'),
        context: getProjectContext(),
        intent: 'Make the drums warm',
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: 'batch-card-group', groupLabel: 'batch card' },
        requiresConfirmation: true,
    });
}

/**
 * One batch of one command per recipe, each recipe its own step, bound to the recipes' goals and to one
 * measured preview per prefix: `previews[0]` is read after the first step, the last after the whole batch.
 */
function admitAndDescribe(input: {
    recipeIds: string[];
    kept: Kept[];
    previews: PreviewFigures[];
    currentRevision?: string;
}) {
    const batch = batchOf(input.recipeIds);
    const compiled = compileBatch(input.recipeIds.length);
    const parsed = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (parsed.status !== 'valid') {
        throw new Error(parsed.reason);
    }
    const { envelope } = parsed;
    const prefixHashes = envelope.commands.map((_, index) => {
        const commands = envelope.commands.slice(0, index + 1);
        const ids = new Set(commands.map((command) => command.commandId));
        return digestCommandBatchContent({
            ...envelope,
            commands,
            batchLocalBindings: envelope.batchLocalBindings.filter((binding) => ids.has(binding.producerCommandId)),
        });
    });
    const authority: MetricRequestAuthority = {
        schemaVersion: 1,
        authorityId: 'batch-card-authority',
        origin: 'vibe-run-plan',
        callId: null,
        turn: null,
        catalogId: 'catalog',
        requestDigest: 'request',
        revision: envelope.baseRevision,
        projectId: captureProjectIdentity(),
        selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
        kind: 'perceptual',
        goals: readGoals(batch, input.kept),
        creativeAuthority: null,
    };
    const bound = bindMetricGoalsToBatch({
        commandBatch: compiled.commandBatch,
        state: {
            schemaVersion: 1,
            authorities: [authority],
            steps: envelope.commands.map((command, index) => ({
                stepId: `recipe:${input.recipeIds[index] ?? ''}:${TARGET_ID}`,
                commandCount: 1,
                operationTypes: [command.operation],
                recipePrefixHash: prefixHashes[index] ?? null,
            })),
            proofs: [],
            binding: null,
        },
    });
    const binding = bound.binding;
    if (binding === null) {
        throw new Error('The batch is unbound.');
    }
    const artifact = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'audio' } };
    const side = (figures: PreviewFigures, pick: 'baseline' | 'preview') =>
        Object.fromEntries(
            Object.entries(figures).map(([metricId, reading]) => [metricId, entry(metricId, reading[pick])])
        );
    const state: MetricGoalState = {
        ...bound,
        proofs: input.previews.map((figures, index) => ({
            receiptDigest: `receipt-${String(index)}`,
            preview: {
                provenance: {
                    origin: 'planner',
                    callId: `measurement-${String(index)}`,
                    turn: 2,
                    runId: RUN_ID,
                    targets: [{ targetId: TARGET_ID, baseline: artifact, preview: artifact }],
                },
                scope: { kind: 'tracks', ids: [TARGET_ID] },
                range: RANGE,
                targets: [
                    {
                        targetId: TARGET_ID,
                        targetKind: 'track',
                        baseline: side(figures, 'baseline'),
                        preview: side(figures, 'preview'),
                        deltas: {},
                    },
                ],
                batchContentHash: prefixHashes[index] ?? binding.contentHash,
                revision: binding.revision,
            },
        })),
    };
    const evaluation = evaluateMetricGoalAdmission({
        state,
        commandBatch: compiled.commandBatch,
        currentRevision: input.currentRevision ?? captureProjectRevision(),
    });
    const lines = describeVibeBatchCard({
        batch,
        context: getProjectContext(),
        criteria: evaluation.criteria,
        adoptedRecipes: [],
        valueChoice: { source: 'catalogue-defaults', reason: 'local-backend', detail: '' },
    });
    return { batch, evaluation, cardLines: lines.filter((line) => line.startsWith(CARD_LINE)) };
}

const KICK = 'Kick';

beforeEach(() => {
    configureMetricGoalProject({
        label: RUN_ID,
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: TARGET_ID, name: KICK, kind: 'audio' }),
                devices: [
                    {
                        id: 'kick-trim',
                        name: 'Kick Trim',
                        type: 'builtin-gain',
                        bypassed: false,
                        parameterValues: { 'gain-level': 0 },
                    },
                ],
            },
        ],
        sections: [],
    });
    expect(
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'batch card',
            mode: 'apply',
            createdRevision: captureProjectRevision(),
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
});

afterEach(() => {
    resetMetricGoalProject();
});

describe('a vibe batch card shows what admission measured', () => {
    it('shows an admitted single-step batch exactly as the card always has', () => {
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-warm'],
            kept: [{ recipeId: 'drums-warm', metricId: 'spectralCentroid' }],
            previews: [{ spectralCentroid: { baseline: 2000, preview: 1800 } }],
        });

        expect(evaluation.status).toBe('verified');
        expect(cardLines).toEqual([
            'Fresh approval preview on Kick, arrangement [0, 4]: spectral centroid 2000 Hz → 1800 Hz (verified).',
        ]);
    });

    it('shows the second criterion its own figures and verdict when the first criterion blocks the batch', () => {
        // The gate's RMS must fall but rises in its step, which blocks the batch before the warm centroid is read.
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-controlled-gate', 'drums-warm'],
            kept: [
                { recipeId: 'drums-controlled-gate', metricId: 'rms' },
                { recipeId: 'drums-warm', metricId: 'spectralCentroid' },
            ],
            previews: [
                { rms: { baseline: -32.48, preview: -31 }, spectralCentroid: { baseline: 2000, preview: 1900 } },
                { rms: { baseline: -32.48, preview: -31 }, spectralCentroid: { baseline: 2000, preview: 1800 } },
            ],
        });

        expect(evaluation.status).toBe('blocked');
        expect(evaluation.failure).toBe('out-of-tolerance');
        expect(cardLines).toHaveLength(2);
        expect(cardLines[0]).toContain('RMS level -32.48 dBFS → -31 dBFS (blocked): not met, expected to fall');
        expect(cardLines[1]).toContain('spectral centroid 2000 Hz → 1800 Hz (verified)');
        expect(cardLines.join('\n')).not.toContain('—');
    });

    it('shows a two-step target from its initial figure to its final one, the pair admission compared', () => {
        // The gate step falls (-31.49 to -31.91) but the batch rose from where it began (-32.48).
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-warm', 'drums-controlled-gate'],
            kept: [
                { recipeId: 'drums-warm', metricId: 'spectralCentroid' },
                { recipeId: 'drums-controlled-gate', metricId: 'rms' },
            ],
            previews: [
                { rms: { baseline: -32.48, preview: -31.49 }, spectralCentroid: { baseline: 2000, preview: 1900 } },
                { rms: { baseline: -32.48, preview: -31.91 }, spectralCentroid: { baseline: 2000, preview: 1800 } },
            ],
        });

        expect(evaluation.status).toBe('blocked');
        expect(cardLines[1]).toContain('RMS level -32.48 dBFS → -31.91 dBFS (blocked): not met, expected to fall');
        expect(cardLines[1]).not.toContain('-31.49');
        expect(cardLines[0]).toContain('spectral centroid 2000 Hz → 1800 Hz (verified)');
    });

    it('names the step figures when a step breaks its criterion though the batch as a whole moved the right way', () => {
        // The gate step rises (-32 to -31.5), yet the batch falls from -31 to -31.5 overall.
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-warm', 'drums-controlled-gate'],
            kept: [{ recipeId: 'drums-controlled-gate', metricId: 'rms' }],
            previews: [{ rms: { baseline: -31, preview: -32 } }, { rms: { baseline: -31, preview: -31.5 } }],
        });

        expect(evaluation.status).toBe('blocked');
        expect(cardLines).toEqual([
            'Fresh approval preview on Kick, arrangement [0, 4]: RMS level -31 dBFS → -31.5 dBFS (blocked): not met, expected to fall; within its own step it went -32 dBFS → -31.5 dBFS.',
        ]);
    });

    it('names no figure cause for criteria admission refused before reading any figure', () => {
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-warm'],
            kept: [{ recipeId: 'drums-warm', metricId: 'spectralCentroid' }],
            previews: [{ spectralCentroid: { baseline: 2000, preview: 1800 } }],
            currentRevision: 'another-revision',
        });

        expect(evaluation.failure).toBe('stale');
        expect(cardLines).toEqual([
            'Fresh approval preview on Kick, arrangement [0, 4]: spectral centroid not evaluated (blocked).',
        ]);
    });

    it('names no figure incompatibility for each criterion of a batch whose frozen criteria contradict', () => {
        const { evaluation, cardLines } = admitAndDescribe({
            // The warm recipe lowers the spectral centroid and the bright one raises it, on the same track.
            recipeIds: ['drums-warm', 'drums-bright'],
            kept: [
                { recipeId: 'drums-warm', metricId: 'spectralCentroid' },
                { recipeId: 'drums-bright', metricId: 'spectralCentroid' },
            ],
            previews: [
                { spectralCentroid: { baseline: 2000, preview: 1900 } },
                { spectralCentroid: { baseline: 2000, preview: 1800 } },
            ],
        });

        expect(evaluation.failure).toBe('contradictory');
        expect(cardLines).toHaveLength(2);
        for (const line of cardLines) {
            expect(line).toMatch(/not evaluated \(blocked\)\.$/);
            expect(line).not.toContain('compatible');
        }
    });

    it('says admission read no compatible figures for a criterion whose preview lacks its metric', () => {
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: ['drums-warm'],
            kept: [{ recipeId: 'drums-warm', metricId: 'spectralCentroid' }],
            previews: [{ rms: { baseline: -32, preview: -31 } }],
        });

        expect(evaluation.failure).toBe('incomparable');
        expect(cardLines).toEqual([
            'Fresh approval preview on Kick, arrangement [0, 4]: spectral centroid not evaluated: admission read no compatible baseline and preview figures for it (blocked).',
        ]);
    });

    it('keeps the verdict and reason of a batch whose first criterion fails, whatever the later ones read', () => {
        const blockedFirst = admitAndDescribe({
            recipeIds: ['drums-controlled-gate', 'drums-warm'],
            kept: [
                { recipeId: 'drums-controlled-gate', metricId: 'rms' },
                { recipeId: 'drums-warm', metricId: 'spectralCentroid' },
            ],
            previews: [
                { rms: { baseline: -32.48, preview: -31 }, spectralCentroid: { baseline: 2000, preview: 1900 } },
                { rms: { baseline: -32.48, preview: -31 }, spectralCentroid: { baseline: 2000, preview: 2100 } },
            ],
        }).evaluation;

        expect(blockedFirst.status).toBe('blocked');
        expect(blockedFirst.failure).toBe('out-of-tolerance');
        expect(blockedFirst.reason).toBe('Actual preview measurements do not satisfy the frozen objective criterion.');
        expect(blockedFirst.criteria.map((criterion) => criterion.outcome)).toEqual(['not-met', 'not-met']);
    });

    it('reports an applied single-step target in the run summary exactly as it always has', () => {
        const { batch, evaluation } = admitAndDescribe({
            recipeIds: ['drums-warm'],
            kept: [{ recipeId: 'drums-warm', metricId: 'spectralCentroid' }],
            previews: [{ spectralCentroid: { baseline: 2000, preview: 1800 } }],
        });

        const summary = describeVibeRunSummary({
            batches: [{ position: 2, batch, outcome: { kind: 'applied', criteria: evaluation.criteria } }],
            context: getProjectContext(),
        });

        expect(summary).toContain(
            '- Batch 2 (warm drums): spectral centroid on Kick approval preview, arrangement [0, 4], 2000 Hz → 1800 Hz.'
        );
    });

    it('reports a two-step target in the run summary from its initial figure to its final one', () => {
        // The warm step ends the centroid at 1900 before the muddy step moves it on to 1800.
        const { batch, evaluation } = admitAndDescribe({
            recipeIds: ['drums-muddy', 'drums-warm'],
            kept: [{ recipeId: 'drums-warm', metricId: 'spectralCentroid' }],
            previews: [
                { spectralCentroid: { baseline: 2000, preview: 1900 } },
                { spectralCentroid: { baseline: 2000, preview: 1800 } },
            ],
        });

        const summary = describeVibeRunSummary({
            batches: [{ position: 2, batch, outcome: { kind: 'applied', criteria: evaluation.criteria } }],
            context: getProjectContext(),
        });

        expect(evaluation.status).toBe('verified');
        expect(summary).toContain('arrangement [0, 4], 2000 Hz → 1800 Hz.');
        expect(summary).not.toContain('1900');
    });
});

describe('a vibe batch card prints figures that read as their verdict', () => {
    const WIDE = 'drums-wide';
    const SIDE_UP = { sideEnergyFraction: { baseline: 0.2, preview: 0.4 } };

    function wideLine(lowFrequencyStereoContent: Reading, side: PreviewFigures = SIDE_UP): string {
        const { cardLines } = admitAndDescribe({
            recipeIds: [WIDE],
            kept: [{ recipeId: WIDE, metricId: 'lowFrequencyStereoContent' }],
            previews: [{ ...side, lowFrequencyStereoContent }],
        });
        return cardLines.join('\n');
    }

    it('prints a hold that broke by a hundredth of a tenth at figures that differ by more than the tolerance', () => {
        expect(wideLine({ baseline: 0.5, preview: 0.5101 })).toBe(
            'Fresh approval preview on Kick, arrangement [0, 4]: low-frequency stereo content held within 0.01 0.5 → 0.5101 (blocked): not met, expected to hold, a movement of 0.0101.'
        );
    });

    it('prints a met hold at the figures it always did', () => {
        expect(wideLine({ baseline: 0.5, preview: 0.509 })).toContain('0.5 → 0.51 (verified)');
    });

    it('prints a rise that two decimals would show as no rise at the digit that shows it', () => {
        const { evaluation, cardLines } = admitAndDescribe({
            recipeIds: [WIDE],
            kept: [{ recipeId: WIDE, metricId: 'sideEnergyFraction' }],
            previews: [{ sideEnergyFraction: { baseline: 0.5, preview: 0.501 } }],
        });
        expect(evaluation.status).toBe('verified');
        expect(cardLines.join('\n')).toContain('side energy fraction 0.5 → 0.501 (verified)');
    });
});
