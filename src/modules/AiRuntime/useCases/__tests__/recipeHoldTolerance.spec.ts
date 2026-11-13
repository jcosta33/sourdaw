import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { type MeasuredMetricEntry } from '../../models/MeasuredPreview';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from '../metricGoalContractTypes';
import { OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { readVibeBatchRecipeGoals } from '../vibeRun/readVibeBatchRecipeGoals';

import { configureMetricGoalProject, resetMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

const RUN_ID = 'recipe-hold-run';
const TARGET_ID = 'bass';
const RANGE = { startBeat: 0, endBeat: 4, sectionId: null };

type Figures = Readonly<Record<string, { baseline: number; preview: number }>>;

function batchOf(recipeId: string): ScheduledVibeRunBatch {
    return {
        id: 'recipe-hold-batch',
        ordinal: 1,
        targetIds: [TARGET_ID],
        targets: [{ targetId: TARGET_ID, recipeIds: [recipeId], expectedDeltas: [], commandCount: 1 }],
        commandCount: 1,
        objective: { descriptors: [], role: 'bass' },
    };
}

function readGoals(recipeId: string): MetricGoal[] {
    const read = readVibeBatchRecipeGoals({
        batch: batchOf(recipeId),
        catalog: getMixRecipeCatalog(),
        range: RANGE,
    });
    if (read.status !== 'read') {
        throw new Error(read.reason);
    }
    // One overall step spans the one compiled command, so the goals judge the whole batch.
    return read.goals.map((goal) => ({ ...goal, stepId: 'overall' }));
}

function entry(metricId: string, value: number): MeasuredMetricEntry {
    const unit = Object.entries(OBJECTIVE_METRIC_UNITS).find(([id]) => id === metricId)?.[1];
    if (unit === undefined) {
        throw new Error(`No unit for ${metricId}.`);
    }
    return { status: 'measured', metricVersion: 1, unit, value, confidence: 'exact' };
}

/** The compiled one-command batch bound to the recipe's goals and one actual-render proof of the given figures. */
function admit(
    recipeId: string,
    figures: Figures,
    editGoals: (goals: MetricGoal[]) => MetricGoal[] = (goals) => goals
) {
    const compiled = compileAgentActionExecution({
        actions: [{ type: 'setDeviceParameter', payload: { deviceId: 'bass-trim', paramId: 'gain-level', value: -1 } }],
        actionLabels: ['setDeviceParameter'],
        context: getProjectContext(),
        intent: 'Make the bass wider',
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: 'recipe-hold-group', groupLabel: 'recipe hold' },
        requiresConfirmation: true,
    });
    const parsed = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (parsed.status !== 'valid') {
        throw new Error(parsed.reason);
    }
    const authority: MetricRequestAuthority = {
        schemaVersion: 1,
        authorityId: 'recipe-hold-authority',
        origin: 'vibe-run-plan',
        callId: null,
        turn: null,
        catalogId: 'catalog',
        requestDigest: 'request',
        revision: parsed.envelope.baseRevision,
        projectId: captureProjectIdentity(),
        selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
        kind: 'perceptual',
        goals: editGoals(readGoals(recipeId)),
        creativeAuthority: null,
    };
    const bound = bindMetricGoalsToBatch({
        commandBatch: compiled.commandBatch,
        state: {
            schemaVersion: 1,
            authorities: [authority],
            steps: [
                {
                    stepId: 'overall',
                    commandCount: parsed.envelope.commands.length,
                    operationTypes: parsed.envelope.commands.map((command) => command.operation),
                    recipePrefixHash: null,
                },
            ],
            proofs: [],
            binding: null,
        },
    });
    const binding = bound.binding;
    if (binding === null) {
        throw new Error('The batch is unbound.');
    }
    const artifact = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'audio' } };
    const side = (pick: 'baseline' | 'preview') =>
        Object.fromEntries(Object.entries(figures).map(([metricId, pair]) => [metricId, entry(metricId, pair[pick])]));
    const state: MetricGoalState = {
        ...bound,
        proofs: [
            {
                receiptDigest: 'receipt',
                preview: {
                    provenance: {
                        origin: 'planner',
                        callId: 'measurement',
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
                            baseline: side('baseline'),
                            preview: side('preview'),
                            deltas: {},
                        },
                    ],
                    batchContentHash: binding.contentHash,
                    revision: binding.revision,
                },
            },
        ],
    };
    return evaluateMetricGoalAdmission({
        state,
        commandBatch: compiled.commandBatch,
        currentRevision: captureProjectRevision(),
    });
}

beforeEach(() => {
    configureMetricGoalProject({
        label: RUN_ID,
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: TARGET_ID, name: 'Bass', kind: 'audio' }),
                devices: [
                    {
                        id: 'bass-trim',
                        name: 'Bass Trim',
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
            request: 'recipe hold',
            mode: 'apply',
            createdRevision: captureProjectRevision(),
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
});

afterEach(() => {
    resetMetricGoalProject();
});

const WIDE_SIDE = { baseline: 0.2, preview: 0.4 };

function wide(lowFrequencyStereoContent: { baseline: number; preview: number }) {
    return admit('bass-wide', { sideEnergyFraction: WIDE_SIDE, lowFrequencyStereoContent });
}

function punchy(transientDensity: { baseline: number; preview: number }) {
    return admit('bass-punchy', { transientDensity });
}

describe('recipe holds at admission', () => {
    it('admits a hold on low-frequency stereo content that rounding moved off exactly zero', () => {
        expect(wide({ baseline: 0, preview: 3.99e-10 })).toMatchObject({ status: 'verified', failure: null });
    });

    it.each([
        ['low-frequency stereo content within tolerance up', 0.5, 0.509, 'verified'],
        ['low-frequency stereo content within tolerance down', 0.5, 0.491, 'verified'],
        ['low-frequency stereo content just past tolerance up', 0.5, 0.5101, 'blocked'],
        ['low-frequency stereo content just past tolerance down', 0.5, 0.4899, 'blocked'],
        ['low-frequency stereo content moved from zero past tolerance', 0, 0.0101, 'blocked'],
    ] as const)('%s', (_label, baseline, preview, status) => {
        const evaluation = wide({ baseline, preview });
        expect(evaluation.status).toBe(status);
        expect(evaluation.failure).toBe(status === 'verified' ? null : 'out-of-tolerance');
    });

    it.each([
        ['gains an onset every four seconds, within tolerance', 4, 4.24, 'verified'],
        ['loses an onset every four seconds, within tolerance', 4, 3.76, 'verified'],
        ['gains more than a quarter onset per second', 4, 4.26, 'blocked'],
        ['loses more than a quarter onset per second', 4, 3.74, 'blocked'],
    ] as const)('holds transient density that %s', (_label, baseline, preview, status) => {
        const evaluation = punchy({ baseline, preview });
        expect(evaluation.status).toBe(status);
        expect(evaluation.failure).toBe(status === 'verified' ? null : 'out-of-tolerance');
    });

    it.each([
        ['NaN after', 0.5, Number.NaN],
        ['NaN before', Number.NaN, 0.5],
        ['+Infinity after', 0.5, Number.POSITIVE_INFINITY],
        ['-Infinity after', 0.5, Number.NEGATIVE_INFINITY],
        ['+Infinity before', Number.POSITIVE_INFINITY, 0.5],
        ['-Infinity before', Number.NEGATIVE_INFINITY, 0.5],
    ] as const)('blocks a hold whose reading is %s as incomparable', (_label, baseline, preview) => {
        expect(wide({ baseline, preview })).toMatchObject({ status: 'blocked', failure: 'incomparable' });
    });

    it('blocks a hold stored at zero for a metric whose hold has a versioned tolerance as a stale source', () => {
        const evaluation = admit(
            'bass-wide',
            { sideEnergyFraction: WIDE_SIDE, lowFrequencyStereoContent: { baseline: 0, preview: 0 } },
            (goals) => goals.map((goal) => (goal.relation === 'hold' ? { ...goal, tolerance: 0 } : goal))
        );
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'stale' });
    });

    it('blocks a hold stored at a looser tolerance than its versioned one as a stale source', () => {
        const evaluation = admit(
            'bass-wide',
            { sideEnergyFraction: WIDE_SIDE, lowFrequencyStereoContent: { baseline: 0.5, preview: 0.6 } },
            (goals) => goals.map((goal) => (goal.relation === 'hold' ? { ...goal, tolerance: 0.2 } : goal))
        );
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'stale' });
    });

    it('keeps increase and decrease goals at tolerance zero and judged by direction alone', () => {
        const goals = readGoals('bass-intimate').map(({ metricId, relation, tolerance }) => ({
            metricId,
            relation,
            tolerance,
        }));
        expect(goals).toEqual([
            { metricId: 'dynamicRangeEstimate', relation: 'decrease', tolerance: 0 },
            { metricId: 'rms', relation: 'increase', tolerance: 0 },
        ]);
        const figures = (range: [number, number], level: [number, number]): Figures => ({
            dynamicRangeEstimate: { baseline: range[0], preview: range[1] },
            rms: { baseline: level[0], preview: level[1] },
        });
        expect(admit('bass-intimate', figures([10, 9.999], [-20, -19.999]))).toMatchObject({ status: 'verified' });
        expect(admit('bass-intimate', figures([10, 10], [-20, -19]))).toMatchObject({
            status: 'blocked',
            failure: 'out-of-tolerance',
        });
        expect(admit('bass-intimate', figures([10, 9], [-20, -20]))).toMatchObject({
            status: 'blocked',
            failure: 'out-of-tolerance',
        });
    });
});

describe('the refusal of a broken recipe hold', () => {
    it('names the metric, target, figures, movement and versioned tolerance with its unit', () => {
        const evaluation = wide({ baseline: 0.5, preview: 0.5123 });
        expect(evaluation.reason).toBe(
            "The preview breaks the recipe's hold on low-frequency stereo content on “Bass”: it moved from 0.5 to 0.512 ratio, a movement of 0.0123 ratio, beyond its 0.01 ratio tolerance."
        );
    });

    it('prints a movement just past tolerance as more than the tolerance, never equal to it', () => {
        const evaluation = punchy({ baseline: 4, preview: 4.2500001 });
        expect(evaluation.reason).toContain('a movement of 0.2500001 per-second, beyond its 0.25 per-second tolerance');
    });
});

describe('compiling a recipe hold', () => {
    it('refuses a batch whose recipe holds a metric with no versioned hold tolerance, naming it', () => {
        const catalog = getMixRecipeCatalog();
        const stub = {
            ...catalog,
            recipes: catalog.recipes.map((recipe) =>
                recipe.id === 'bass-wide'
                    ? { ...recipe, metrics: [{ metric: 'stereoCorrelation' as const, direction: 'hold' as const }] }
                    : recipe
            ),
        };
        expect(readVibeBatchRecipeGoals({ batch: batchOf('bass-wide'), catalog: stub, range: RANGE })).toEqual({
            status: 'refused',
            reason: 'recipe bass-wide holds stereoCorrelation, which has no versioned hold tolerance',
        });
    });

    it('compiles each recipe hold at its metric tolerance and each movement at zero', () => {
        expect(
            readGoals('bass-wide').map(({ metricId, relation, tolerance }) => ({ metricId, relation, tolerance }))
        ).toEqual([
            { metricId: 'sideEnergyFraction', relation: 'increase', tolerance: 0 },
            { metricId: 'lowFrequencyStereoContent', relation: 'hold', tolerance: 0.01 },
        ]);
        expect(readGoals('bass-punchy').map(({ metricId, tolerance }) => ({ metricId, tolerance }))).toEqual([
            { metricId: 'transientDensity', tolerance: 0.25 },
        ]);
    });
});
