import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE, type CanonicalRole } from './canonicalRoleFamilies';
import { type ProjectContextTrack } from './getProjectContext';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type RecipeRole = MixRecipeCatalog['roles'][number];

/**
 * A folder only changes the view; its devices sit outside its child tracks' signal path
 * (docs/manual/02-concepts.md:42), so the recipe tools refuse a folder target instead of
 * offering device work the planner could never apply there.
 */
export const FOLDER_TARGET_WARNING =
    "This target is a folder; it only changes the view and does not process its child tracks' audio. Target those tracks or a bus instead.";

export type ResolvedTarget = {
    id: string;
    kind: string;
    deviceTypes: readonly string[];
    devices: readonly { id: string; type: string; bypassed: boolean }[];
    canonicalRole: CanonicalRole;
    frozen: boolean;
};

export type ResolvedRole = {
    recipeRole: RecipeRole | null;
    source: 'argument' | 'target' | 'none';
    canonicalRole?: CanonicalRole;
};

type ResolveRecipeTargetInput = {
    catalog: MixRecipeCatalog;
    tracks: readonly ProjectContextTrack[];
    targetId: string | null;
    roleArgument: string | null;
};

type ResolveRecipeTargetResult =
    | { status: 'not-found'; targetId: string }
    | { status: 'resolved'; target: ResolvedTarget | null; role: ResolvedRole };

/** Narrows the context's structural-copy role string to the live catalog, falling back to `unknown`. */
function resolveCanonicalRole(raw: string | undefined): CanonicalRole {
    return CANONICAL_ROLE_OPTIONS.find((role) => role === raw) ?? 'unknown';
}

function resolveTrack(track: ProjectContextTrack): ResolvedTarget {
    return {
        id: track.id,
        kind: track.kind,
        deviceTypes: track.devices.map((device) => device.type),
        devices: track.devices.map((device) => ({ id: device.id, type: device.type, bypassed: device.bypassed })),
        canonicalRole: resolveCanonicalRole(track.canonicalRole?.role),
        frozen: track.frozen ?? false,
    };
}

/** An explicit `role` argument first, else the target's canonical role through the shared table. */
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

/**
 * The one reading of a recipe tool's `targetId` and `role` against the project. Recipe discovery
 * and recipe expansion both resolve here, so a target and a role one accepts are the same target
 * and role the other sees. A resolved `null` role means neither argument named one.
 */
export function resolveRecipeTarget(input: ResolveRecipeTargetInput): ResolveRecipeTargetResult {
    const track =
        input.targetId === null ? undefined : input.tracks.find((candidate) => candidate.id === input.targetId);
    if (input.targetId !== null && track === undefined) {
        return { status: 'not-found', targetId: input.targetId };
    }
    const target = track === undefined ? null : resolveTrack(track);
    return { status: 'resolved', target, role: resolveRole(input.catalog, input.roleArgument, target) };
}
