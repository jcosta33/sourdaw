import { getFactoryPresets, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { RECIPE_EXPANSION_MAX_COMMANDS } from '../models/RecipeExpansionLimits';

import { countRecipeExpansionCommands } from './countRecipeExpansionCommands';
import { getProjectContext, type ProjectContextTrack } from './getProjectContext';
import { type RecipeDiscoveryInput } from './parseRecipeDiscoveryInput';
import {
    FOLDER_TARGET_WARNING,
    type ResolvedRole,
    type ResolvedTarget,
    resolveRecipeTarget,
} from './resolveRecipeTarget';
import { servesAnySourceScope } from './servesAnySourceScope';
import { servesDrumPart } from './servesDrumPart';

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
    /** Null only on a factory chain preset whose own tags name no perceptual descriptor. */
    descriptor: RecipeDescriptor | null;
    effect: RecipeDescriptorEffect | null;
    title: string;
    roles: readonly RecipeRole[];
    steps: readonly RecipeDiscoveryStep[];
    prerequisites: readonly string[];
    contraindications: readonly string[];
    metrics: MixRecipe['metrics'];
    /** Present only on a recipe published from a factory preset; an authored recipe carries none. */
    origin?: MixRecipe['origin'];
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

/** The words of a text, lowercased, so a term matches a name or tag word whatever its case or punctuation. */
function readWords(text: string): string[] {
    return normalizeDescriptorTerm(text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 0);
}

/**
 * The words a preset answers to: its authored name's words, each authored tag, and each tag's words.
 * A recipe published from a preset not in the factory library answers to its tags alone.
 */
function readPresetTokens(recipe: MixRecipe, presetNames: ReadonlyMap<string, string>): ReadonlySet<string> {
    if (recipe.origin === undefined) {
        return new Set();
    }
    const name = presetNames.get(recipe.origin.presetId) ?? '';
    const tags = recipe.origin.tags.map(normalizeDescriptorTerm);
    return new Set([...readWords(name), ...tags, ...tags.flatMap(readWords)]);
}

function matchesPresetTerm(tokens: ReadonlySet<string>, term: string): boolean {
    const words = readWords(term);
    return tokens.has(term) || (words.length > 0 && words.every((word) => tokens.has(word)));
}

/**
 * The recipes a call asks for, in catalog order: those naming a resolved descriptor, and the preset
 * recipes a preset term names. A call naming no descriptor term and no preset term asks for every
 * preset recipe, so a role alone browses them. Also the preset terms no preset name or tag carries.
 */
function selectRequestedRecipes(
    catalog: MixRecipeCatalog,
    resolvedDescriptors: readonly RecipeDescriptor[],
    presetTerms: readonly string[],
    namesNoDescriptorTerm: boolean
): { recipes: MixRecipe[]; unmatchedPresetTerms: string[] } {
    const presetNames = new Map(getFactoryPresets().map((preset) => [preset.id, preset.name]));
    const tokens = new Map(
        catalog.recipes.map((recipe) => [recipe.id, readPresetTokens(recipe, presetNames)] as const)
    );
    const selection: RecipeSelection = {
        resolvedDescriptors,
        presetTerms,
        browsesPresets: namesNoDescriptorTerm && presetTerms.length === 0,
        tokens,
    };
    return {
        recipes: catalog.recipes.filter((recipe) => isRequestedRecipe(recipe, selection)),
        unmatchedPresetTerms: presetTerms.filter(
            (term) => !catalog.recipes.some((recipe) => matchesPresetTerm(readRecipeTokens(selection, recipe), term))
        ),
    };
}

type RecipeSelection = {
    resolvedDescriptors: readonly RecipeDescriptor[];
    presetTerms: readonly string[];
    browsesPresets: boolean;
    tokens: ReadonlyMap<string, ReadonlySet<string>>;
};

function readRecipeTokens(selection: RecipeSelection, recipe: MixRecipe): ReadonlySet<string> {
    return selection.tokens.get(recipe.id) ?? new Set();
}

function isRequestedRecipe(recipe: MixRecipe, selection: RecipeSelection): boolean {
    if (recipe.descriptor !== null && selection.resolvedDescriptors.includes(recipe.descriptor)) {
        return true;
    }
    if (recipe.origin === undefined) {
        return false;
    }
    return (
        selection.browsesPresets ||
        selection.presetTerms.some((term) => matchesPresetTerm(readRecipeTokens(selection, recipe), term))
    );
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

/**
 * A recipe naming no role serves any source scope. Any other recipe matches the role resolved, or
 * every role when nothing resolved one; a target whose own role resolves none matches only the
 * recipes that need no role. A drum-family target matches only the recipes serving its drum part.
 */
function matchesRole(recipe: MixRecipe, target: ResolvedTarget | null, role: ResolvedRole): boolean {
    if (recipe.roles.length === 0) {
        return servesAnySourceScope(target, role);
    }
    if (role.recipeRole === null) {
        return role.source === 'none';
    }
    return recipe.roles.includes(role.recipeRole) && servesDrumPart(recipe, target?.canonicalRole);
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
    effects: MixRecipeCatalog['descriptorEffects']
): RecipeDiscoveryCandidate {
    const candidate: RecipeDiscoveryCandidate = {
        id: recipe.id,
        descriptor: recipe.descriptor,
        effect: recipe.descriptor === null ? null : effects[recipe.descriptor],
        title: recipe.title,
        roles: recipe.roles,
        steps: recipe.steps.map((step) => buildStep(step, target)),
        prerequisites: recipe.prerequisites,
        contraindications: recipe.contraindications,
        metrics: recipe.metrics,
    };
    if (recipe.origin === undefined) {
        return candidate;
    }
    return { ...candidate, origin: recipe.origin };
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
 * Resolves perceptual descriptor terms, factory preset name or tag terms, and an optional target or
 * role into a bounded page of mixing recipes.
 *
 * Descriptor terms select the recipes naming those descriptors, authored and preset. Preset terms
 * select the preset recipes whose authored name words or tags contain a term, so a chain whose
 * tags name no descriptor is still found. A call naming neither lists the preset recipes serving
 * the role.
 *
 * A target's canonical role selects the recipe role only when no `role`
 * argument overrides it; either way, an existing target's device chain still
 * excludes a recipe whose `edit` step names a device type the chain lacks,
 * because retuning a device that is not there is not an executable move. A
 * target whose canonical role gives no recipe role is offered only the recipes
 * that name no role, beside a warning asking for a role argument.
 *
 * The tracks default to the live project's; a caller holding the context a request was planned
 * against passes that read instead, so discovery and the request see one project.
 */
export function discoverMixRecipes(
    input: RecipeDiscoveryInput,
    tracks: readonly ProjectContextTrack[] = getProjectContext().tracks
): DiscoverMixRecipesResult {
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
    const presetTerms = input.presetTerms.map(normalizeDescriptorTerm);

    const resolution = resolveRecipeTarget({
        catalog,
        tracks,
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
    }

    const requested = selectRequestedRecipes(catalog, resolvedDescriptors, presetTerms, terms.length === 0);
    if (requested.unmatchedPresetTerms.length > 0) {
        warnings.push(`No factory preset name or tag matches: ${requested.unmatchedPresetTerms.join(', ')}.`);
    }
    const roleMatches = requested.recipes.filter((recipe) => matchesRole(recipe, target, role));
    const expandable = roleMatches.filter(
        (recipe) => countRecipeExpansionCommands(recipe) <= RECIPE_EXPANSION_MAX_COMMANDS
    );
    const withheldForSize = roleMatches.length - expandable.length;
    if (withheldForSize > 0) {
        warnings.push(
            `${String(withheldForSize)} matching recipe(s) withheld: each expands to more than the ${String(RECIPE_EXPANSION_MAX_COMMANDS)} commands one expansion may add to a batch.`
        );
    }

    let excludedForChain = 0;
    const matches = expandable.filter((recipe) => {
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
        .map((recipe) => buildCandidate(recipe, target, catalog.descriptorEffects));

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
