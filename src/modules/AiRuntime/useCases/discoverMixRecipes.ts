import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { getProjectContext, type ProjectContextTrack } from './getProjectContext';
import { type RecipeDiscoveryInput } from './parseRecipeDiscoveryInput';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipe = MixRecipeCatalog['recipes'][number];
type MixRecipeStep = MixRecipe['steps'][number];
type RecipeDescriptor = MixRecipeCatalog['descriptors'][number];
type RecipeRole = MixRecipeCatalog['roles'][number];

/**
 * Every canonical track role this catalog can resolve to a recipe role.
 *
 * `fx` and `unknown` map to no recipe role: a track holding either needs an
 * explicit `role` argument before a candidate can be filtered by role at all.
 */
const CANONICAL_ROLE_TO_RECIPE_ROLE: Readonly<Record<string, RecipeRole | null>> = {
    kick: 'drums',
    snare: 'drums',
    'hi-hat': 'drums',
    tom: 'drums',
    cymbal: 'drums',
    percussion: 'drums',
    drums: 'drums',
    'lead vocal': 'vocal',
    'backing vocal': 'vocal',
    bass: 'bass',
    guitar: 'guitar',
    keys: 'keys',
    synth: 'keys',
    pad: 'keys',
    bus: 'bus',
    master: 'master',
    fx: null,
    unknown: null,
};

type ResolvedTarget = {
    id: string;
    deviceTypes: readonly string[];
    devices: readonly { id: string; type: string }[];
    canonicalRole: string;
};

type ResolvedRole = {
    recipeRole: RecipeRole | null;
    source: 'argument' | 'target' | 'none';
    canonicalRole?: string;
};

type RecipeDiscoveryTermResolution = { term: string; descriptor: RecipeDescriptor | null };

type RecipeDiscoveryStep = {
    kind: MixRecipeStep['kind'];
    deviceType: string;
    parameters: readonly { paramId: string; minimum: number; maximum: number }[];
    existingDeviceIds?: readonly string[];
};

type RecipeDiscoveryCandidate = {
    id: string;
    descriptor: RecipeDescriptor;
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

type ResolveTargetResult =
    { status: 'none' } | { status: 'not-found'; targetId: string } | { status: 'found'; target: ResolvedTarget };

function resolveTarget(targetId: string | null, tracks: readonly ProjectContextTrack[]): ResolveTargetResult {
    if (targetId === null) {
        return { status: 'none' };
    }
    const track = tracks.find((candidate) => candidate.id === targetId);
    if (!track) {
        return { status: 'not-found', targetId };
    }
    return {
        status: 'found',
        target: {
            id: track.id,
            deviceTypes: track.devices.map((device) => device.type),
            devices: track.devices.map((device) => ({ id: device.id, type: device.type })),
            canonicalRole: track.canonicalRole?.role ?? 'unknown',
        },
    };
}

function resolveRole(
    catalog: MixRecipeCatalog,
    roleArgument: string | null,
    target: ResolvedTarget | null
): ResolvedRole {
    if (roleArgument !== null) {
        const recipeRole = catalog.roles.find((role) => role === roleArgument) ?? null;
        return { recipeRole, source: 'argument' };
    }
    if (target !== null) {
        return {
            recipeRole: CANONICAL_ROLE_TO_RECIPE_ROLE[target.canonicalRole] ?? null,
            source: 'target',
            canonicalRole: target.canonicalRole,
        };
    }
    return { recipeRole: null, source: 'none' };
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
        return { kind: step.kind, deviceType: step.deviceType, parameters };
    }
    return {
        kind: step.kind,
        deviceType: step.deviceType,
        parameters,
        existingDeviceIds: target.devices
            .filter((device) => device.type === step.deviceType)
            .map((device) => device.id),
    };
}

function buildCandidate(recipe: MixRecipe, target: ResolvedTarget | null): RecipeDiscoveryCandidate {
    return {
        id: recipe.id,
        descriptor: recipe.descriptor,
        title: recipe.title,
        roles: recipe.roles,
        steps: recipe.steps.map((step) => buildStep(step, target)),
        prerequisites: recipe.prerequisites,
        contraindications: recipe.contraindications,
        metrics: recipe.metrics,
    };
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
        return { term, descriptor: resolveTermDescriptor(catalog, term) };
    });
    const resolvedDescriptors = dedupeInFirstSeenOrder(
        terms.flatMap((entry) => (entry.descriptor === null ? [] : [entry.descriptor]))
    );
    const unresolvedTerms = terms.filter((entry) => entry.descriptor === null).map((entry) => entry.term);

    const targetResolution = resolveTarget(input.targetId, getProjectContext().tracks);
    if (targetResolution.status === 'not-found') {
        return { status: 'invalid-target', targetId: targetResolution.targetId };
    }
    const target = targetResolution.status === 'found' ? targetResolution.target : null;

    const role = resolveRole(catalog, input.role, target);
    const receiptTarget = target === null ? null : { id: target.id, deviceTypes: target.deviceTypes };

    const warnings: string[] = [];
    if (unresolvedTerms.length > 0) {
        warnings.push(
            `Unresolved descriptor term(s): ${unresolvedTerms.join(', ')}. Known descriptors: ${catalog.descriptors.join(', ')}.`
        );
    }
    if (role.source === 'target' && role.recipeRole === null) {
        warnings.push(
            `This target's canonical role, ${role.canonicalRole ?? 'unknown'}, has no recipe role; pass a role argument to select one.`
        );
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
                total: 0,
                excludedForChain: 0,
                candidates: [],
            },
        };
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

    const candidates = matches.slice(0, input.limit).map((recipe) => buildCandidate(recipe, target));

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
