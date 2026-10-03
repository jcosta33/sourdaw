import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { getProjectContext } from './getProjectContext';
import { type RecipeDiscoveryInput } from './parseRecipeDiscoveryInput';
import {
    FOLDER_TARGET_WARNING,
    type ResolvedRole,
    type ResolvedTarget,
    resolveRecipeTarget,
} from './resolveRecipeTarget';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipe = MixRecipeCatalog['recipes'][number];
type MixRecipeStep = MixRecipe['steps'][number];
type RecipeDescriptor = MixRecipeCatalog['descriptors'][number];
type RecipeRole = MixRecipeCatalog['roles'][number];
type RecipeDescriptorEffect = MixRecipeCatalog['descriptorEffects'][RecipeDescriptor];

type RecipeDiscoveryTermResolution = {
    term: string;
    descriptor: RecipeDescriptor | null;
    effect: RecipeDescriptorEffect | null;
};

type RecipeDiscoveryStep = {
    kind: MixRecipeStep['kind'];
    deviceType: string;
    parameters: readonly { paramId: string; minimum: number; maximum: number }[];
    existingDevices: readonly { id: string; bypassed: boolean }[];
};

type RecipeDiscoveryCandidate = {
    id: string;
    descriptor: RecipeDescriptor;
    effect: RecipeDescriptorEffect;
    title: string;
    roles: readonly RecipeRole[];
    steps: readonly RecipeDiscoveryStep[];
    prerequisites: readonly string[];
    contraindications: readonly string[];
    metrics: MixRecipe['metrics'];
};

export type RecipeDiscoveryReceiptData = {
    schema: 'sourdaw.recipe-discovery';
    schemaVersion: 1;
    catalogVersion: MixRecipeCatalog['version'];
    terms: readonly RecipeDiscoveryTermResolution[];
    role: ResolvedRole;
    target: { id: string; deviceTypes: readonly string[] } | null;
    total: number;
    excludedForChain: number;
    candidates: readonly RecipeDiscoveryCandidate[];
};

export type DiscoverMixRecipesResult =
    | { status: 'invalid-target'; targetId: string }
    | { status: 'ok'; warnings: readonly string[]; data: RecipeDiscoveryReceiptData };

/** Lowercase, trimmed, and collapsed to single spaces so a term matches the catalog's own lookup keys. */
function normalizeDescriptorTerm(raw: string): string {
    return raw.toLowerCase().trim().replaceAll(/\s+/g, ' ');
}

function resolveTermDescriptor(catalog: MixRecipeCatalog, term: string): RecipeDescriptor | null {
    return catalog.descriptors.find((descriptor) => catalog.descriptorTerms[descriptor].includes(term)) ?? null;
}

function dedupeInFirstSeenOrder(values: readonly RecipeDescriptor[]): RecipeDescriptor[] {
    const seen = new Set<RecipeDescriptor>();
    const ordered: RecipeDescriptor[] = [];
    for (const value of values) {
        if (!seen.has(value)) {
            seen.add(value);
            ordered.push(value);
        }
    }
    return ordered;
}

function matchesRole(recipe: MixRecipe, role: ResolvedRole): boolean {
    if (role.recipeRole === null) {
        return true;
    }
    return recipe.roles.includes(role.recipeRole);
}

function isExcludedForChain(recipe: MixRecipe, target: ResolvedTarget): boolean {
    return recipe.steps.some((step) => step.kind === 'edit' && !target.deviceTypes.includes(step.deviceType));
}

function buildStep(step: MixRecipeStep, target: ResolvedTarget | null): RecipeDiscoveryStep {
    const parameters = step.parameters.map((parameter) => ({
        paramId: parameter.paramId,
        minimum: parameter.minimum,
        maximum: parameter.maximum,
    }));
    if (target === null) {
        return { kind: step.kind, deviceType: step.deviceType, parameters, existingDevices: [] };
    }
    return {
        kind: step.kind,
        deviceType: step.deviceType,
        parameters,
        existingDevices: target.devices
            .filter((device) => device.type === step.deviceType)
            .map((device) => ({ id: device.id, bypassed: device.bypassed })),
    };
}

function buildCandidate(
    recipe: MixRecipe,
    target: ResolvedTarget | null,
    effect: RecipeDescriptorEffect
): RecipeDiscoveryCandidate {
    return {
        id: recipe.id,
        descriptor: recipe.descriptor,
        effect,
        title: recipe.title,
        roles: recipe.roles,
        steps: recipe.steps.map((step) => buildStep(step, target)),
        prerequisites: recipe.prerequisites,
        contraindications: recipe.contraindications,
        metrics: recipe.metrics,
    };
}

/** The fault noun each corrective descriptor's recipe removes, for the unresolved-term warning. */
const CORRECTIVE_DESCRIPTOR_FAULT_NOUNS: Readonly<Partial<Record<RecipeDescriptor, string>>> = {
    muddy: 'mud',
    thin: 'thinness',
};

/**
 * One line naming every accepted term, grouped by descriptor, so a caller
 * whose term went unresolved can retry with a term this catalog knows. Each
 * `'removes'` descriptor is marked with the fault its recipe removes, because
 * its terms otherwise read as a request for the fault itself.
 */
function describeAcceptedTerms(catalog: MixRecipeCatalog): string {
    return catalog.descriptors
        .map((descriptor) => {
            const terms = catalog.descriptorTerms[descriptor].join(', ');
            if (catalog.descriptorEffects[descriptor] === 'removes') {
                const fault = CORRECTIVE_DESCRIPTOR_FAULT_NOUNS[descriptor];
                return `${descriptor} (removes ${fault}): ${terms}`;
            }
            return `${descriptor}: ${terms}`;
        })
        .join('; ');
}

/**
 * Resolves perceptual descriptor terms and an optional target or role into a
 * bounded page of authored mixing recipes.
 *
 * A target's canonical role selects the recipe role only when no `role`
 * argument overrides it; either way, an existing target's device chain still
 * excludes a recipe whose `edit` step names a device type the chain lacks,
 * because retuning a device that is not there is not an executable move.
 */
export function discoverMixRecipes(input: RecipeDiscoveryInput): DiscoverMixRecipesResult {
    const catalog = getMixRecipeCatalog();
    const terms = input.descriptors.map((raw) => {
        const term = normalizeDescriptorTerm(raw);
        const descriptor = resolveTermDescriptor(catalog, term);
        return { term, descriptor, effect: descriptor === null ? null : catalog.descriptorEffects[descriptor] };
    });
    const resolvedDescriptors = dedupeInFirstSeenOrder(
        terms.flatMap((entry) => (entry.descriptor === null ? [] : [entry.descriptor]))
    );
    const unresolvedTerms = terms.filter((entry) => entry.descriptor === null).map((entry) => entry.term);

    const resolution = resolveRecipeTarget({
        catalog,
        tracks: getProjectContext().tracks,
        targetId: input.targetId,
        roleArgument: input.role,
    });
    if (resolution.status === 'not-found') {
        return { status: 'invalid-target', targetId: resolution.targetId };
    }
    const { target, role } = resolution;
    const receiptTarget = target === null ? null : { id: target.id, deviceTypes: target.deviceTypes };
    const noCandidates: RecipeDiscoveryReceiptData = {
        schema: 'sourdaw.recipe-discovery',
        schemaVersion: 1,
        catalogVersion: catalog.version,
        terms,
        role,
        target: receiptTarget,
        total: 0,
        excludedForChain: 0,
        candidates: [],
    };

    if (target !== null && target.kind === 'folder') {
        return { status: 'ok', warnings: [FOLDER_TARGET_WARNING], data: noCandidates };
    }

    const warnings: string[] = [];
    if (unresolvedTerms.length > 0) {
        warnings.push(
            `Unresolved descriptor term(s): ${unresolvedTerms.join(', ')}. Accepted terms — ${describeAcceptedTerms(catalog)}.`
        );
    }
    if (target !== null && target.frozen) {
        warnings.push('This target is frozen; device changes are refused while it is frozen.');
    }
    if (role.source === 'target' && role.recipeRole === null) {
        warnings.push(
            `This target's canonical role, ${role.canonicalRole ?? 'unknown'}, has no recipe role; pass a role argument to select one.`
        );
        return { status: 'ok', warnings, data: noCandidates };
    }

    const roleMatches = catalog.recipes.filter(
        (recipe) => resolvedDescriptors.includes(recipe.descriptor) && matchesRole(recipe, role)
    );

    let excludedForChain = 0;
    const matches = roleMatches.filter((recipe) => {
        if (target === null) {
            return true;
        }
        if (isExcludedForChain(recipe, target)) {
            excludedForChain += 1;
            return false;
        }
        return true;
    });

    const candidates = matches
        .slice(0, input.limit)
        .map((recipe) => buildCandidate(recipe, target, catalog.descriptorEffects[recipe.descriptor]));

    return {
        status: 'ok',
        warnings,
        data: {
            schema: 'sourdaw.recipe-discovery',
            schemaVersion: 1,
            catalogVersion: catalog.version,
            terms,
            role,
            target: receiptTarget,
            total: matches.length,
            excludedForChain,
            candidates,
        },
    };
}
