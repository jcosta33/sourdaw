import { type ProjectContext } from '../../models/ProjectContext';

import { type ProtectableObjectName } from './protectionObjectForms';
import { type ReferenceCandidate } from './refinementRequestReading';

/** The extra names a project holds that the refinement reader's candidates leave out. */
function getExtraCandidates(context: ProjectContext): ReferenceCandidate[] {
    const groups: Array<ReadonlyArray<{ id: string; name: string }> | undefined> = [
        context.markers,
        context.sections,
        context.automationLanes,
        context.adjustmentLayers,
    ];
    const named = groups.flatMap((objects) => objects ?? []);
    return named.map((object) => ({
        name: object.name
            .toLocaleLowerCase()
            .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
            .trim(),
        denotes: new Set([object.id]),
    }));
}

function normalizeName(name: string): string {
    return name
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** The tracks, buses and VCA groups a kind form can bind a variant of a name to, by normalized name. */
function readProtectableObjects(context: ProjectContext): ProtectableObjectName[] {
    const tracks = context.tracks.map((track) => ({
        name: normalizeName(track.name),
        kind: track.kind === 'bus' ? ('bus' as const) : ('track' as const),
        trackIds: [track.id],
    }));
    const groups = (context.vcaGroups ?? []).map((group) => ({
        name: normalizeName(group.name),
        kind: 'group' as const,
        trackIds: group.trackIds,
    }));
    return [...tracks, ...groups];
}

/** The project names the explicit-protection reader binds beyond the refinement reader's own candidates. */
export const protectionCandidates = {
    extraCandidates: getExtraCandidates,
    protectableObjects: readProtectableObjects,
} as const;
