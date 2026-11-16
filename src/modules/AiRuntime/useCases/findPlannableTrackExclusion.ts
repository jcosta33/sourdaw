import { type ProjectContextTrack } from '../models/ProjectContext';
import { type VibeRunExcludedTargetReason } from '../models/VibeRunPlan';

import { resolveRoleFamily } from './canonicalRoleFamilies';

/**
 * What `recipe.expand` refuses a track for before it reads any recipe: guarded, a folder, frozen, or
 * holding no role family. A whole-project vibe run and the creative catalog's agent-decided targets
 * both read it, so a track one would never touch the other never offers.
 */
export function findPlannableTrackExclusion(
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
