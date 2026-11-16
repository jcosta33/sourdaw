import { collectProtectedScopes, isProjectWideScope } from '#/modules/Project/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../models/ProjectContext';

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
export function readBriefProtectedTrackIds(context: Pick<ProjectContext, 'tracks' | 'productionBrief'>): Set<string> {
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
