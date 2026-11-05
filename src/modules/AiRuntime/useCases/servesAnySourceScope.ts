import { type ResolvedRole, type ResolvedTarget } from './resolveRecipeTarget';

/** The track kinds that carry a source: a bus or the master sums sources, and a folder only groups the view. */
const SOURCE_TRACK_KINDS: ReadonlySet<string> = new Set(['audio', 'midi']);

/**
 * Whether a recipe that names no role may serve this scope. Such a recipe is a generic processor
 * that serves any source, so it fits an audio or MIDI track whatever that track's own role, and an
 * untargeted request unless the role resolved is a bus or the master: a summing scope is a choice
 * a recipe has to be authored for.
 */
export function servesAnySourceScope(target: ResolvedTarget | null, role: ResolvedRole): boolean {
    if (role.recipeRole === 'bus' || role.recipeRole === 'master') {
        return false;
    }
    return target === null || SOURCE_TRACK_KINDS.has(target.kind);
}
