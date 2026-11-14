import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import * as arrangement from '#/modules/Arrangement/useCases';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { getProjectContext } from '../getProjectContext';
import { METRIC_HOLD_TOLERANCES, readRecipeExpectationTolerance } from '../metricHoldTolerances';
import { OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { PERCEPTUAL_CONSTRAINT_INVARIANTS } from '../perceptualConstraints/perceptualConstraintInvariants';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';

import { createPlanningProject } from './planningProjectFixture';

registerDeviceEnginePorts();

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...actual, getMixRecipeCatalog: vi.fn(actual.getMixRecipeCatalog) };
});

const { getMixRecipeCatalog: authoredCatalog } = await vi.importActual<typeof import('#/modules/Arrangement/useCases')>(
    '#/modules/Arrangement/useCases'
);

afterEach(() => {
    vi.mocked(arrangement.getMixRecipeCatalog).mockImplementation(authoredCatalog);
});

function isMetricWithEntry(metric: string): metric is keyof typeof METRIC_HOLD_TOLERANCES {
    return Object.hasOwn(METRIC_HOLD_TOLERANCES, metric);
}

type CatalogRecipe = ReturnType<typeof authoredCatalog>['recipes'][number];

/** The bass-wide recipe rewritten to hold a metric the tolerance table has no entry for. */
function holdStereoCorrelationOnBassWide(recipe: CatalogRecipe): CatalogRecipe {
    if (recipe.id !== 'bass-wide') {
        return recipe;
    }
    return { ...recipe, metrics: [{ metric: 'stereoCorrelation', direction: 'hold' }] };
}

describe('versioned hold tolerances', () => {
    it('pins each tolerance id to its value, so a value changes only under a new id', () => {
        expect(
            Object.fromEntries(Object.values(METRIC_HOLD_TOLERANCES).map((entry) => [entry.toleranceId, entry.value]))
        ).toEqual({
            'frequency-band-energy-hold-v1': 0.01,
            'low-frequency-stereo-content-hold-v1': 0.01,
            'rms-hold-v1': 0.5,
            'dynamic-range-estimate-hold-v1': 1,
            'integrated-loudness-hold-v1': 0.5,
            'crest-factor-hold-v1': 1,
            'side-energy-fraction-hold-v1': 0.01,
            'spectral-centroid-hold-v1': 50,
            'transient-density-hold-v1': 0.25,
        });
    });

    it('states each tolerance in its metric own unit', () => {
        for (const [metric, entry] of Object.entries(METRIC_HOLD_TOLERANCES)) {
            expect({ metric, unit: entry.unit }).toEqual({
                metric,
                unit: OBJECTIVE_METRIC_UNITS[metric as keyof typeof OBJECTIVE_METRIC_UNITS],
            });
        }
    });

    it('gives every authored recipe hold a tolerance, so a recipe holding an unlisted metric fails here', () => {
        const holds = getMixRecipeCatalog()
            .recipes.filter((recipe) => recipe.origin === undefined)
            .flatMap((recipe) =>
                recipe.metrics
                    .filter((expectation) => expectation.direction === 'hold')
                    .map((expectation) => ({ recipeId: recipe.id, metric: expectation.metric }))
            );
        expect(holds.length).toBeGreaterThan(0);
        for (const hold of holds) {
            expect({ ...hold, listed: isMetricWithEntry(hold.metric) }).toEqual({ ...hold, listed: true });
        }
    });

    it('holds every perceptual constraint to its metric tolerance', () => {
        const rows = Object.values(PERCEPTUAL_CONSTRAINT_INVARIANTS).flat();
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect({ metricId: row.metricId, tolerance: row.tolerance }).toEqual({
                metricId: row.metricId,
                tolerance: METRIC_HOLD_TOLERANCES[row.metricId]?.value,
            });
        }
    });

    it('reads a hold at its tolerance, a movement at zero, and an unlisted hold as missing', () => {
        expect(readRecipeExpectationTolerance('lowFrequencyStereoContent', 'hold')).toEqual({
            status: 'read',
            tolerance: 0.01,
        });
        expect(readRecipeExpectationTolerance('lowFrequencyStereoContent', 'increase')).toEqual({
            status: 'read',
            tolerance: 0,
        });
        expect(readRecipeExpectationTolerance('stereoCorrelation', 'decrease')).toEqual({
            status: 'read',
            tolerance: 0,
        });
        expect(readRecipeExpectationTolerance('stereoCorrelation', 'hold')).toEqual({ status: 'missing' });
    });
});

describe('the metric intent catalog compiles recipe holds', () => {
    function recipeGoals(prompt: string) {
        const context = createPlanningProject(getProjectContext(), 3);
        const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'metric-revision' });
        return prepareMetricIntentCatalog({ prompt, answer }).objectives.flatMap((objective) =>
            objective.goals.flatMap((goal) =>
                goal.source.kind === 'recipe' ? [{ recipeId: goal.source.recipeId, goal }] : []
            )
        );
    }

    it('gives a provider-selected hold its metric tolerance and a movement zero', () => {
        const goals = new Map(
            recipeGoals('Make the bass punchy and wide').map(
                ({ recipeId, goal }) => [`${recipeId}:${goal.metricName}`, goal] as const
            )
        );
        expect(goals.get('bass-wide:lowFrequencyStereoContent')).toMatchObject({
            metricId: 'lowFrequencyStereoContent',
            relation: 'hold',
            tolerance: 0.01,
        });
        expect(goals.get('bass-wide:sideEnergyFraction')).toMatchObject({
            relation: 'increase',
            tolerance: 0,
        });
        expect(goals.get('bass-punchy:transientDensity')).toMatchObject({
            metricId: 'transientDensity',
            relation: 'hold',
            tolerance: 0.25,
        });
    });

    it('compiles a hold on a metric with no versioned tolerance as unsupported with no metric, never at zero', () => {
        const catalog = authoredCatalog();
        vi.mocked(arrangement.getMixRecipeCatalog).mockImplementation(() => ({
            ...catalog,
            recipes: catalog.recipes.map(holdStereoCorrelationOnBassWide),
        }));
        const goals = recipeGoals('Make the bass wide')
            .filter((entry) => entry.recipeId === 'bass-wide')
            .map((entry) => entry.goal);
        expect(goals).toMatchObject([
            { metricName: 'stereoCorrelation', metricId: null, relation: 'hold', tolerance: 0 },
        ]);
    });
});
