import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { hasContradictoryMetricGoals } from '../hasContradictoryMetricGoals';
import { type MetricGoal } from '../metricGoalContractTypes';
import { readAuthoredRecipeGoals } from '../readAuthoredRecipeGoals';

registerDeviceEnginePorts();

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

const RANGE = { startBeat: 0, endBeat: 16, sectionId: null };

/**
 * A vibe run pools the goals of every requested descriptor's recipe on one role into one target, and
 * the whole-run fit refuses a run whose pooled goals contradict. This reads each recipe's goals as the
 * run does and applies the run's own predicate.
 */
function goalsOf(recipe: MixRecipe, catalogVersion: number): MetricGoal[] {
    const read = readAuthoredRecipeGoals({
        recipe,
        catalogVersion,
        targetId: 'track',
        stepId: recipe.id,
        ranges: [RANGE],
        goalId: (index) => `${recipe.id}:${String(index)}`,
    });
    if (read.status === 'refused') {
        throw new TypeError(read.reason);
    }
    return read.goals;
}

/** Every pair of authored recipes of different descriptors on a shared role whose pooled goals contradict. */
function readContradictingPairs(): string[] {
    const catalog = getMixRecipeCatalog();
    const authored = catalog.recipes.filter((recipe) => recipe.origin === undefined && recipe.metrics.length > 0);
    const pairs: string[] = [];
    for (const [index, left] of authored.entries()) {
        for (const right of authored.slice(index + 1)) {
            const sharesRole = left.roles.some((role) => right.roles.includes(role));
            if (!sharesRole || left.descriptor === right.descriptor) {
                continue;
            }
            const pooled = [...goalsOf(left, catalog.version), ...goalsOf(right, catalog.version)];
            if (hasContradictoryMetricGoals(pooled)) {
                pairs.push(`${left.id}|${right.id}`);
            }
        }
    }
    return pairs;
}

/**
 * Tight recipes whose low-shelf trim states the bass band falling, against the same role's warm or thin
 * recipe stating it rising, so a request for both is refused as contradictory. The render law cannot
 * move the claim to dynamic range for these: on its source 0, which each recipe's compressor is meant
 * for, the recipe raises the dynamic range estimate, so a decrease claim would be false there. The bus
 * recipe's dynamic-range claim holds on every source meant for it, so it is not listed.
 */
const TIGHT_CONTRADICTIONS: readonly string[] = [
    'vocal-warm|vocal-tight',
    'vocal-tight|vocal-thin',
    'drums-warm|drums-tight',
    'drums-tight|drums-thin',
    'guitar-warm|guitar-tight',
    'keys-warm|keys-tight',
];

/**
 * Every other pair that contradicts: recipes of opposing characters (bright and dark, airy and lo-fi,
 * wide and intimate) and corrective or transient recipes whose claims oppose a neighbour's. A request
 * naming both descriptors is refused, which is the run doing its job, so none of these is a defect to repair.
 */
const OTHER_CONTRADICTIONS: readonly string[] = [
    'vocal-warm|vocal-bright',
    'vocal-bright|vocal-dark',
    'vocal-bright|vocal-thin',
    'vocal-airy|vocal-lo-fi',
    'vocal-airy|vocal-vintage',
    'drums-warm|drums-bright',
    'drums-bright|drums-dark',
    'drums-punchy|drums-controlled-gate',
    'drums-punchy|drums-tight-transient',
    'drums-intimate|drums-airy',
    'drums-intimate|drums-controlled-gate',
    'drums-intimate|drums-tight-transient',
    'drums-airy|drums-lo-fi',
    'drums-airy|drums-vintage',
    'drums-thin|drums-controlled-gate',
    'drums-thin|drums-tight-transient',
    'drums-vintage|drums-tight-transient',
    'drums-vintage|drums-punchy-transient',
    'bass-warm|bass-bright',
    'bass-bright|bass-dark',
    'bass-airy|bass-lo-fi',
    'bass-airy|bass-vintage',
    'guitar-warm|guitar-bright',
    'guitar-bright|guitar-dark',
    'guitar-bright|guitar-thin',
    'guitar-airy|guitar-lo-fi',
    'guitar-airy|guitar-vintage',
    'guitar-muddy|guitar-thin',
    'keys-warm|keys-bright',
    'keys-bright|keys-dark',
    'keys-bright|keys-thin',
    'keys-airy|keys-lo-fi',
    'keys-airy|keys-vintage',
    'keys-muddy|keys-thin',
    'bus-warm|bus-bright',
    'bus-bright|bus-dark',
    'bus-airy|bus-lo-fi',
    'bus-airy|bus-vintage',
    'master-warm|master-bright',
    'master-bright|master-dark',
    'master-tight|master-thin',
    'master-wide|master-intimate',
    'master-airy|master-lo-fi',
    'master-airy|master-vintage',
];

describe('authored recipes a vibe run can pool on one role', () => {
    it('contradict one another only on the pairs the two tables name, by the run own predicate', () => {
        expect(readContradictingPairs().sort()).toEqual([...TIGHT_CONTRADICTIONS, ...OTHER_CONTRADICTIONS].sort());
    });

    it('lets a bus be asked for warm and tight together', () => {
        expect(readContradictingPairs()).not.toContain('bus-warm|bus-tight');
        expect(readContradictingPairs()).not.toContain('bus-tight|bus-thin');
    });
});
