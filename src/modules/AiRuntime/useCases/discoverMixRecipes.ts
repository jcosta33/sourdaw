import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getCanonicalTrackRoleOptions } from '#/modules/Project/useCases';

import { getProjectContext, type ProjectContextTrack } from './getProjectContext';
import { type RecipeDiscoveryInput } from './parseRecipeDiscoveryInput';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipe = MixRecipeCatalog['recipes'][number];
type MixRecipeStep = MixRecipe['steps'][number];
type RecipeDescriptor = MixRecipeCatalog['descriptors'][number];
type RecipeRole = MixRecipeCatalog['roles'][number];
type RecipeDescriptorEffect = MixRecipeCatalog['descriptorEffects'][RecipeDescriptor];
type CanonicalRole = ReturnType<typeof getCanonicalTrackRoleOptions>[number];

/** Every role this module can narrow a project track's raw evidence string down to. */
const CANONICAL_ROLE_OPTIONS = getCanonicalTrackRoleOptions();

/**
 * Every canonical track role this catalog can resolve to a recipe role.
 *
 * `fx` and `unknown` map to no recipe role: a track holding either needs an
 * explicit `role` argument before a candidate can be filtered by role at all.
 * Keyed by the complete `CanonicalRole` union, so a role this catalog forgets
 * to place fails typecheck rather than silently resolving to no recipe role.
 */
const CANONICAL_ROLE_TO_RECIPE_ROLE: Readonly<Record<CanonicalRole, RecipeRole | null>> = {
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
    kind: string;
    deviceTypes: readonly string[];
    devices: readonly { id: string; type: string; bypassed: boolean }[];
    canonicalRole: CanonicalRole;
    frozen: boolean;
};

/**
 * Track kinds whose devices never gate their tracks' audio: a folder only changes the view and
 * its devices sit outside its child tracks' signal path (docs/manual/02-concepts.md:42), and a
 * VCA controls level only and refuses device adds (deviceStrategy.ts). Recipe discovery refuses
 * these targets instead of returning device recipes the planner could never apply there.
 */
const NON_AUDIO_PROCESSING_TARGET_WARNINGS: Readonly<Partial<Record<string, string>>> = {
    folder: "This target is a folder; it only changes the view and does not process its child tracks' audio. Target those tracks or a bus instead.",
    vca: "This target is a VCA; it controls level only and does not process its tracks' audio. Target those tracks or a bus instead.",
};

type ResolvedRole = {
    recipeRole: RecipeRole | null;
    source: 'argument' | 'target' | 'none';
    canonicalRole?: CanonicalRole;
};

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

type ResolveTargetResult =
    { status: 'none' } | { status: 'not-found'; targetId: string } | { status: 'found'; target: ResolvedTarget };

/** Narrows the context's structural-copy role string to the live catalog, falling back to `unknown`. */
function resolveCanonicalRole(raw: string | undefined): CanonicalRole {
    return CANONICAL_ROLE_OPTIONS.find((role) => role === raw) ?? 'unknown';
}

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
            kind: track.kind,
            deviceTypes: track.devices.map((device) => device.type),
            devices: track.devices.map((device) => ({ id: device.id, type: device.type, bypassed: device.bypassed })),
            canonicalRole: resolveCanonicalRole(track.canonicalRole?.role),
            frozen: track.frozen ?? false,
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
            recipeRole: CANONICAL_ROLE_TO_RECIPE_ROLE[target.canonicalRole],
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

    const targetResolution = resolveTarget(input.targetId, getProjectContext().tracks);
    if (targetResolution.status === 'not-found') {
        return { status: 'invalid-target', targetId: targetResolution.targetId };
    }
    const target = targetResolution.status === 'found' ? targetResolution.target : null;

    const role = resolveRole(catalog, input.role, target);
    const receiptTarget = target === null ? null : { id: target.id, deviceTypes: target.deviceTypes };

    const nonAudioProcessingWarning = target === null ? undefined : NON_AUDIO_PROCESSING_TARGET_WARNINGS[target.kind];
    if (nonAudioProcessingWarning !== undefined) {
        return {
            status: 'ok',
            warnings: [nonAudioProcessingWarning],
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
