import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type ProjectContext, type ProjectContextSection, type ProjectContextTrack } from '../models/ProjectContext';
import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES, type SemanticCommandListRoleFamily } from '../models/SemanticCommandList';
import {
    type VibeRunBaseline,
    type VibeRunBatch,
    type VibeRunExpectedDelta,
    type VibeRunMeasurement,
    type VibeRunPlan,
    type VibeRunSectionScope,
    type VibeRunUnplannedRole,
} from '../models/VibeRunPlan';

import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE } from './canonicalRoleFamilies';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipe = MixRecipeCatalog['recipes'][number];
type MixRecipeDescriptor = MixRecipeCatalog['descriptors'][number];

type PlanWholeProjectVibeRunInput = {
    context: Pick<ProjectContext, 'tracks' | 'sections' | 'productionBrief'>;
    /** The characters the request names, resolved to the recipe catalog's descriptors. */
    descriptors: readonly MixRecipeDescriptor[];
    recipes: readonly MixRecipe[];
    /** Baseline measurements, one per `analysis.measure` call already made; none is rendered here. */
    measurements: readonly VibeRunMeasurement[];
};

/** A batch spends at least one command on each target it names, so its target count is the cap. */
const MAX_TARGETS_PER_BATCH = MAX_LLM_ACTIONS_PER_BATCH;

function resolveRoleFamily(track: ProjectContextTrack): SemanticCommandListRoleFamily | null {
    const role = CANONICAL_ROLE_OPTIONS.find((candidate) => candidate === track.canonicalRole?.role) ?? 'unknown';
    return CANONICAL_ROLE_TO_RECIPE_ROLE[role];
}

function orderSections(sections: readonly ProjectContextSection[]): VibeRunSectionScope[] {
    return sections
        .filter((section) => section.endBeat > section.startBeat)
        .toSorted(
            (left, right) =>
                left.startBeat - right.startBeat || left.endBeat - right.endBeat || left.id.localeCompare(right.id)
        )
        .map(({ id, startBeat, endBeat }) => ({ id, startBeat, endBeat }));
}

function readLockedTrackIds(brief: ProjectContext['productionBrief']): Set<string> {
    const locked = new Set<string>();
    for (const lock of brief?.locks ?? []) {
        if (lock.scope.kind === 'track') {
            locked.add(lock.scope.trackId);
        }
    }
    return locked;
}

function dedupeInFirstSeenOrder<Value>(values: readonly Value[]): Value[] {
    return [...new Set(values)];
}

/** Evenly sized slices, so a set just over the cap does not leave a one-target tail batch. */
function splitWithinCap(targetIds: readonly string[]): string[][] {
    const sliceCount = Math.ceil(targetIds.length / MAX_TARGETS_PER_BATCH);
    const sliceSize = Math.ceil(targetIds.length / sliceCount);
    const slices: string[][] = [];
    for (let start = 0; start < targetIds.length; start += sliceSize) {
        slices.push(targetIds.slice(start, start + sliceSize));
    }
    return slices;
}

function readRoleRecipes(input: PlanWholeProjectVibeRunInput, role: SemanticCommandListRoleFamily): MixRecipe[] {
    return input.recipes.filter(
        (recipe) => input.descriptors.includes(recipe.descriptor) && recipe.roles.includes(role)
    );
}

/** Only a metric `analysis.measure` can report is an expectation a later preview can check. */
function readExpectedDeltas(recipes: readonly MixRecipe[]): VibeRunExpectedDelta[] {
    const measurable = new Set<string>(getAgentMeasurementMetricIds());
    const deltas = new Map<string, VibeRunExpectedDelta>();
    for (const recipe of recipes) {
        for (const expectation of recipe.metrics) {
            if (!measurable.has(expectation.metric)) {
                continue;
            }
            const delta: VibeRunExpectedDelta = {
                descriptor: recipe.descriptor,
                metric: expectation.metric,
                band: expectation.band ?? null,
                direction: expectation.direction,
            };
            deltas.set(JSON.stringify(delta), delta);
        }
    }
    return [...deltas.values()];
}

function readBaselines(
    measurements: readonly VibeRunMeasurement[],
    targetIds: readonly string[],
    sectionIds: ReadonlySet<string>,
    metrics: ReadonlySet<string>
): VibeRunBaseline[] {
    const baselines: VibeRunBaseline[] = [];
    for (const targetId of targetIds) {
        for (const measurement of measurements) {
            const { sectionId } = measurement.range;
            if (sectionId !== null && !sectionIds.has(sectionId)) {
                continue;
            }
            const target = measurement.targets.find((candidate) => candidate.targetId === targetId);
            if (target === undefined) {
                continue;
            }
            const figures = Object.fromEntries(
                Object.entries(target.measurements).filter(([metric]) => metrics.has(metric))
            );
            if (Object.keys(figures).length > 0) {
                baselines.push({ targetId, sectionId, measurements: figures });
            }
        }
    }
    return baselines;
}

/**
 * Decompose a whole-project vibe request into an ordered run of bounded batches, from project truth
 * alone. Nothing here hardcodes a section name or an output-group name: a batch's scope is a role
 * family (read through the canonical role table from each track's derived role) and the project's own
 * sections, and what it is expected to move comes from the recipe catalog entries for the requested
 * characters on that role.
 *
 * Role families run in the selector vocabulary's order, which puts sources before the groups that
 * carry them and the master last. A family with more targets than one batch holds is cut into
 * even slices. A family no requested character has a measurable recipe for is reported, not planned.
 * The plan reads baselines the caller already measured; it renders nothing and writes nothing.
 */
export function planWholeProjectVibeRun(input: PlanWholeProjectVibeRunInput): VibeRunPlan {
    const lockedTrackIds = readLockedTrackIds(input.context.productionBrief);
    const lockedTargetIds: string[] = [];
    const unclassifiedTargetIds: string[] = [];
    const targetIdsByRole = new Map<SemanticCommandListRoleFamily, string[]>();
    for (const track of input.context.tracks) {
        const role = resolveRoleFamily(track);
        if (lockedTrackIds.has(track.id)) {
            lockedTargetIds.push(track.id);
        } else if (role === null) {
            unclassifiedTargetIds.push(track.id);
        } else {
            const roleTargetIds = targetIdsByRole.get(role) ?? [];
            roleTargetIds.push(track.id);
            targetIdsByRole.set(role, roleTargetIds);
        }
    }

    const sections = orderSections(input.context.sections ?? []);
    const sectionIds = new Set(sections.map((section) => section.id));
    const sectionGoals = (input.context.productionBrief?.sectionGoals ?? [])
        .filter((goal) => sectionIds.has(goal.sectionId))
        .map(({ sectionId, statement }) => ({ sectionId, statement }));

    const batches: VibeRunBatch[] = [];
    const unplannedRoles: VibeRunUnplannedRole[] = [];
    for (const role of SEMANTIC_COMMAND_LIST_ROLE_FAMILIES) {
        const roleTargetIds = targetIdsByRole.get(role) ?? [];
        if (roleTargetIds.length === 0) {
            continue;
        }
        const recipes = readRoleRecipes(input, role);
        const expectedDeltas = readExpectedDeltas(recipes);
        if (expectedDeltas.length === 0) {
            unplannedRoles.push({ role, reason: 'no-expected-deltas', targetIds: roleTargetIds });
            continue;
        }
        const metrics = new Set(expectedDeltas.map((delta) => delta.metric));
        const descriptors = dedupeInFirstSeenOrder(expectedDeltas.map((delta) => delta.descriptor));
        const recipeIds = recipes
            .filter((recipe) => descriptors.includes(recipe.descriptor))
            .map((recipe) => recipe.id);
        for (const targetIds of splitWithinCap(roleTargetIds)) {
            const ordinal = batches.length + 1;
            const baselines = readBaselines(input.measurements, targetIds, sectionIds, metrics);
            const measuredTargetIds = new Set(baselines.map((baseline) => baseline.targetId));
            batches.push({
                id: `vibe-batch-${String(ordinal)}`,
                ordinal,
                objective: { descriptors, role, sections, sectionGoals, recipeIds },
                targetIds,
                expectedDeltas,
                baselines,
                unmeasuredTargetIds: targetIds.filter((targetId) => !measuredTargetIds.has(targetId)),
            });
        }
    }

    return {
        schemaVersion: 1,
        briefRevision: input.context.productionBrief?.revision ?? null,
        batches,
        lockedTargetIds,
        unclassifiedTargetIds,
        unplannedRoles,
    };
}
