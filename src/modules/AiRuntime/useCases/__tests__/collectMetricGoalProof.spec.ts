import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type MeasuredPreview } from '../../models/MeasuredPreview';
import { type RetainedCompilation } from '../../models/RetainedCompilation';
import { collectMetricGoalProof } from '../collectMetricGoalProof';
import { expandMixRecipe } from '../expandMixRecipe';
import { getProjectContext } from '../getProjectContext';
import { type MetricRequestAuthority } from '../metricGoalContractTypes';

import { createPlanningProject } from './planningProjectFixture';

registerDeviceEnginePorts();

const catalog = getMixRecipeCatalog();
const recipe = catalog.recipes.find((entry) => entry.id === 'bass-warm');
const expectationIndex =
    recipe?.metrics.findIndex((entry) => entry.metric === 'spectralCentroid' && entry.direction === 'decrease') ?? -1;
if (recipe === undefined || expectationIndex < 0) {
    throw new Error('The Bass warm recipe must hold a spectral centroid decrease.');
}
const context = createPlanningProject(getProjectContext(), 2);
const bass = context.tracks[1];
if (bass === undefined) {
    throw new Error('The planning project must contain Bass.');
}
const targetId = bass.id;
const expansion = expandMixRecipe({ recipeId: recipe.id, targetId, role: 'bass', values: [] }, context, 1, catalog);
if (expansion.status !== 'expanded') {
    throw new Error(`Expected a Bass warm recipe expansion: ${expansion.reason}`);
}

const authority: MetricRequestAuthority = {
    schemaVersion: 1,
    authorityId: 'metric-intake',
    origin: 'configured-joint-intake',
    callId: 'intake',
    turn: 3,
    catalogId: 'catalog',
    requestDigest: digest('Make Bass warmer'),
    revision: 'revision-1',
    projectId: 'project-1',
    selection: { trackId: targetId, clipId: null, clipIds: [], activeView: 'mix' },
    kind: 'perceptual',
    goals: [
        {
            goalId: 'bass-centroid',
            stepId: `recipe:${recipe.id}:${targetId}`,
            metricId: 'spectralCentroid',
            band: null,
            targetIds: [targetId],
            referenceTargetIds: [],
            range: { startBeat: 0, endBeat: 4, sectionId: null },
            relation: 'decrease',
            targetValue: null,
            tolerance: 0,
            source: {
                kind: 'recipe',
                recipeId: recipe.id,
                catalogVersion: catalog.version,
                recipeDigest: digest(recipe),
                expectationIndex,
            },
        },
    ],
    creativeAuthority: null,
};

function measuredInput(turn: number, origin: 'planner' | 'approval-preview' = 'planner') {
    const baseline = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'baseline-audio' } };
    const rendered = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'preview-audio' } };
    const baselineMetric = {
        status: 'measured',
        metricVersion: 1,
        unit: 'Hz',
        value: 900,
        confidence: 'exact',
    } as const;
    const previewMetric = {
        status: 'measured',
        metricVersion: 1,
        unit: 'Hz',
        value: 800,
        confidence: 'exact',
    } as const;
    const target = {
        targetId,
        targetKind: 'track' as const,
        baseline: { spectralCentroid: baselineMetric },
        preview: { spectralCentroid: previewMetric },
        deltas: { spectralCentroid: { status: 'compared' as const, delta: -100, unit: 'Hz' } },
    };
    const preview: MeasuredPreview = {
        provenance: {
            origin,
            callId: 'measurement',
            turn,
            runId: 'run-1',
            targets: [{ targetId, baseline, preview: rendered }],
        },
        scope: { kind: 'tracks', ids: [targetId] },
        range: { startBeat: 0, endBeat: 4, sectionId: null },
        targets: [target],
        recipeSource: expansion.recipe,
        batchContentHash: digest('batch'),
        revision: 'revision-1',
    };
    const compilation: RetainedCompilation = {
        kind: 'preview',
        callId: 'measurement',
        revision: 'revision-1',
        commands: expansion.commands,
        measuredPreview: preview,
    };
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: 'measurement',
        toolName: 'analysis.measure',
        turn,
        ...(origin === 'approval-preview' ? { origin: 'application-verification' as const } : {}),
        status: 'success',
        revision: 'revision-1',
        data: {
            kind: 'analysis-measurement',
            schemaVersion: 1,
            subject: 'preview',
            scope: preview.scope,
            sourceRevisionDigest: digest('revision-1'),
            range: { ...preview.range, baselineSeconds: 2, previewSeconds: 2 },
            metrics: ['spectralCentroid'],
            targets: [{ ...target, baselineRender: baseline, previewRender: rendered }],
        },
        summary: 'Measured the proposal preview against the project for 1 target(s) over beats 0 to 4.',
        warnings: [],
        error: null,
    };
    return { preview, compilation, receipt };
}

describe('collectMetricGoalProof', () => {
    it('admits a planner preview only after the configured intake turn', () => {
        expect(expansion.commands).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    operation: 'addDevice',
                    arguments: expect.objectContaining({ trackId: targetId, deviceType: 'builtin-eq' }),
                }),
                expect.objectContaining({
                    operation: 'setDeviceParameter',
                    arguments: expect.objectContaining({ paramId: 'eq-high-gain', value: -2 }),
                }),
            ])
        );
        for (const turn of [2, 3]) {
            const { compilation, receipt } = measuredInput(turn);
            expect(
                collectMetricGoalProof({ authorities: [authority], compilations: [compilation], receipts: [receipt] })
            ).toEqual([]);
        }
        const { preview, compilation, receipt } = measuredInput(4);
        expect(
            collectMetricGoalProof({ authorities: [authority], compilations: [compilation], receipts: [receipt] })
        ).toEqual([{ preview, receiptDigest: digest(receipt) }]);
    });

    it('admits application verification at turn zero beside a configured intake', () => {
        const { preview, compilation, receipt } = measuredInput(0, 'approval-preview');
        expect(
            collectMetricGoalProof({ authorities: [authority], compilations: [compilation], receipts: [receipt] })
        ).toEqual([{ preview, receiptDigest: digest(receipt) }]);
    });
});
