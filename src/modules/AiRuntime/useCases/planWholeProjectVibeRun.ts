import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { collectProtectedScopes, isProjectWideScope } from '#/modules/Project/useCases';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type ProjectContext, type ProjectContextSection, type ProjectContextTrack } from '../models/ProjectContext';
import { RECIPE_EXPANSION_MAX_COMMANDS } from '../models/RecipeExpansionLimits';
import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES, type SemanticCommandListRoleFamily } from '../models/SemanticCommandList';
import {
    type VibeRunBaseline,
    type VibeRunBeatWindow,
    type VibeRunBatch,
    type VibeRunExcludedTarget,
    type VibeRunExcludedTargetReason,
    type VibeRunExpectedDelta,
    type VibeRunMeasurement,
    type VibeRunPlan,
    type VibeRunSectionScope,
    type VibeRunUnplannedRole,
} from '../models/VibeRunPlan';

import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE } from './canonicalRoleFamilies';
import { countRecipeExpansionCommands } from './countRecipeExpansionCommands';

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

/** A track the run may touch, with the recipes `recipe.expand` would accept for it and what they expand to. */
type PlannableTarget = {
    id: string;
    recipes: readonly MixRecipe[];
    commandCount: number;
};

type SectionBaseline = { status: 'none' } | { status: 'conflict' } | { status: 'found'; baseline: VibeRunBaseline };

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

/** An object scope may name the track itself or anything it owns, as batch admission reads it. */
function trackOwnsObject(track: ProjectContextTrack, objectId: string): boolean {
    return (
        track.id === objectId ||
        track.clips.some((clip) => clip.id === objectId) ||
        track.devices.some((device) => device.id === objectId)
    );
}

/**
 * The tracks the brief protects, read through the same protected-scope source batch admission reads:
 * locks and locked decisions alike. A project-wide protection reaches every track. A range, section
 * or decision scope guards what a time-ranged or brief-naming action touches, which a device recipe
 * on a track does not.
 */
function readProtectedTrackIds(context: PlanWholeProjectVibeRunInput['context']): Set<string> {
    const brief = context.productionBrief;
    if (brief === undefined) {
        return new Set();
    }
    const scopes = collectProtectedScopes(brief).map((protection) => protection.scope);
    if (scopes.some((scope) => isProjectWideScope(scope))) {
        return new Set(context.tracks.map((track) => track.id));
    }
    const protectedIds = new Set<string>();
    for (const track of context.tracks) {
        const isProtected = scopes.some(
            (scope) =>
                (scope.kind === 'track' && scope.trackId === track.id) ||
                (scope.kind === 'object' && trackOwnsObject(track, scope.objectId))
        );
        if (isProtected) {
            protectedIds.add(track.id);
        }
    }
    return protectedIds;
}

/** What `recipe.expand` refuses a track for before it reads any recipe: guarded, a folder, or frozen. */
function findExclusion(
    track: ProjectContextTrack,
    protectedIds: ReadonlySet<string>
): VibeRunExcludedTargetReason | null {
    if (protectedIds.has(track.id)) {
        return 'protected';
    }
    if (track.kind === 'folder') {
        return 'folder';
    }
    if (track.frozen === true) {
        return 'frozen';
    }
    if (resolveRoleFamily(track) === null) {
        return 'unclassified-role';
    }
    return null;
}

/** An edit step retunes exactly one live device of its type; `recipe.expand` refuses any other count. */
function canApplyEditSteps(recipe: MixRecipe, track: ProjectContextTrack): boolean {
    return recipe.steps.every(
        (step) =>
            step.kind !== 'edit' ||
            track.devices.filter((device) => device.type === step.deviceType && !device.bypassed).length === 1
    );
}

function hasMeasurableMetric(recipe: MixRecipe, measurable: ReadonlySet<string>): boolean {
    return recipe.metrics.some((expectation) => measurable.has(expectation.metric));
}

/** The recipes the request's characters name for one role that a single expansion may add to a batch. */
function readRolePlanRecipes(input: PlanWholeProjectVibeRunInput, role: SemanticCommandListRoleFamily): MixRecipe[] {
    const measurable = new Set<string>(getAgentMeasurementMetricIds());
    return input.recipes.filter(
        (recipe) =>
            input.descriptors.includes(recipe.descriptor) &&
            recipe.roles.includes(role) &&
            hasMeasurableMetric(recipe, measurable) &&
            countRecipeExpansionCommands(recipe) <= RECIPE_EXPANSION_MAX_COMMANDS
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

/**
 * Fill each batch with targets in order until the next target's expanded commands would pass the
 * cap, so no batch expands to more commands than one batch may carry.
 */
function packWithinCommandCap(targets: readonly PlannableTarget[]): PlannableTarget[][] {
    const groups: PlannableTarget[][] = [];
    let current: PlannableTarget[] = [];
    let currentCommands = 0;
    for (const target of targets) {
        if (current.length > 0 && currentCommands + target.commandCount > MAX_LLM_ACTIONS_PER_BATCH) {
            groups.push(current);
            current = [];
            currentCommands = 0;
        }
        current.push(target);
        currentCommands += target.commandCount;
    }
    if (current.length > 0) {
        groups.push(current);
    }
    return groups;
}

function windowCoversSection(window: VibeRunMeasurement['range'], section: VibeRunSectionScope): boolean {
    return window.startBeat <= section.startBeat && window.endBeat >= section.endBeat;
}

function windowIsSection(window: VibeRunBeatWindow, section: VibeRunSectionScope): boolean {
    return window.startBeat === section.startBeat && window.endBeat === section.endBeat;
}

/**
 * The one figure that stands for a target in a section: a measurement of exactly the section's
 * window, else a single measurement of a wider window that contains it. A window that stops inside
 * the section says nothing about the rest of it, and two figures competing for the same target and
 * section are a conflict that stands for neither.
 */
function readSectionBaseline(
    measurements: readonly VibeRunMeasurement[],
    targetId: string,
    section: VibeRunSectionScope,
    metrics: ReadonlySet<string>
): SectionBaseline {
    const candidates: VibeRunBaseline[] = [];
    for (const measurement of measurements) {
        if (!windowCoversSection(measurement.range, section)) {
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
            const { startBeat, endBeat } = measurement.range;
            candidates.push({ targetId, sectionId: section.id, window: { startBeat, endBeat }, measurements: figures });
        }
    }
    const exact = candidates.filter((candidate) => windowIsSection(candidate.window, section));
    const standing = exact.length > 0 ? exact : candidates;
    const [baseline] = standing;
    if (baseline === undefined) {
        return { status: 'none' };
    }
    if (standing.length > 1) {
        return { status: 'conflict' };
    }
    return { status: 'found', baseline };
}

function readBatchBaselines(
    measurements: readonly VibeRunMeasurement[],
    targetIds: readonly string[],
    sections: readonly VibeRunSectionScope[],
    metrics: ReadonlySet<string>
): Pick<VibeRunBatch, 'baselines' | 'baselineConflicts'> {
    const baselines: VibeRunBaseline[] = [];
    const baselineConflicts: { targetId: string; sectionId: string }[] = [];
    for (const targetId of targetIds) {
        for (const section of sections) {
            const result = readSectionBaseline(measurements, targetId, section, metrics);
            if (result.status === 'found') {
                baselines.push(result.baseline);
            } else if (result.status === 'conflict') {
                baselineConflicts.push({ targetId, sectionId: section.id });
            }
        }
    }
    return { baselines, baselineConflicts };
}

/**
 * Decompose a whole-project vibe request into an ordered run of bounded batches, from project truth
 * alone. Nothing here hardcodes a section name or an output-group name: a batch's scope is a role
 * family (read through the canonical role table from each track's derived role) and the project's own
 * sections, and what it is expected to move comes from the recipe catalog entries for the requested
 * characters on that role.
 *
 * A track the brief protects, or `recipe.expand` would refuse, is excluded and reported. Role
 * families run in the selector vocabulary's order, which puts sources before the groups that carry
 * them and the master last. A batch is bounded by the commands its recipes expand to over its
 * targets, never by its target count. A family no requested character has a measurable recipe for,
 * and a target whose recipes alone pass the cap, are reported, not planned. The plan reads baselines
 * the caller already measured; it renders nothing and writes nothing.
 */
export function planWholeProjectVibeRun(input: PlanWholeProjectVibeRunInput): VibeRunPlan {
    const protectedIds = readProtectedTrackIds(input.context);
    const excludedTargets: VibeRunExcludedTarget[] = [];
    const tracksByRole = new Map<SemanticCommandListRoleFamily, ProjectContextTrack[]>();
    for (const track of input.context.tracks) {
        const reason = findExclusion(track, protectedIds);
        const role = resolveRoleFamily(track);
        if (reason !== null) {
            excludedTargets.push({ targetId: track.id, reason });
        } else if (role !== null) {
            const roleTracks = tracksByRole.get(role) ?? [];
            roleTracks.push(track);
            tracksByRole.set(role, roleTracks);
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
        const roleTracks = tracksByRole.get(role) ?? [];
        if (roleTracks.length === 0) {
            continue;
        }
        const rolePlanRecipes = readRolePlanRecipes(input, role);
        if (rolePlanRecipes.length === 0) {
            unplannedRoles.push({ role, reason: 'no-expected-deltas', targetIds: roleTracks.map((track) => track.id) });
            continue;
        }
        const plannable: PlannableTarget[] = [];
        const oversizedTargetIds: string[] = [];
        for (const track of roleTracks) {
            const recipes = rolePlanRecipes.filter((recipe) => canApplyEditSteps(recipe, track));
            const commandCount = recipes.reduce((total, recipe) => total + countRecipeExpansionCommands(recipe), 0);
            if (recipes.length === 0) {
                excludedTargets.push({ targetId: track.id, reason: 'no-applicable-recipe' });
            } else if (commandCount > MAX_LLM_ACTIONS_PER_BATCH) {
                oversizedTargetIds.push(track.id);
            } else {
                plannable.push({ id: track.id, recipes, commandCount });
            }
        }
        if (oversizedTargetIds.length > 0) {
            unplannedRoles.push({ role, reason: 'target-exceeds-batch-cap', targetIds: oversizedTargetIds });
        }
        for (const group of packWithinCommandCap(plannable)) {
            const recipes = rolePlanRecipes.filter((recipe) => group.some((target) => target.recipes.includes(recipe)));
            const expectedDeltas = readExpectedDeltas(recipes);
            const targetIds = group.map((target) => target.id);
            const ordinal = batches.length + 1;
            const { baselines, baselineConflicts } = readBatchBaselines(
                input.measurements,
                targetIds,
                sections,
                new Set(expectedDeltas.map((delta) => delta.metric))
            );
            const measuredTargetIds = new Set(baselines.map((baseline) => baseline.targetId));
            batches.push({
                id: `vibe-batch-${String(ordinal)}`,
                ordinal,
                objective: {
                    descriptors: [...new Set(recipes.map((recipe) => recipe.descriptor))],
                    role,
                    sections,
                    sectionGoals,
                    recipeIds: recipes.map((recipe) => recipe.id),
                },
                targetIds,
                expectedDeltas,
                commandCount: group.reduce((total, target) => total + target.commandCount, 0),
                baselines,
                unmeasuredTargetIds: targetIds.filter((targetId) => !measuredTargetIds.has(targetId)),
                baselineConflicts,
            });
        }
    }

    return {
        schemaVersion: 1,
        briefRevision: input.context.productionBrief?.revision ?? null,
        batches,
        excludedTargets,
        unplannedRoles,
    };
}
