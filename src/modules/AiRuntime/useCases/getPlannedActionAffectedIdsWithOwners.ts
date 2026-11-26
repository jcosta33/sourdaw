import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';

import { findTargetOwnerTrackIds } from './agentReference/findTargetOwnerTrackIds';
import { proposalCommandShape } from './agentReference/proposalCommandShape';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';

/**
 * The ids {@link getPlannedActionAffectedIds} names plus the live track that owns each existing
 * object a registry target names (a device's, clip's or lane's track, a layer's tracks, a VCA
 * group's members), so a write that names only the object still reaches its track. An id minted in
 * the same batch has no live owner; its creating command names the track.
 */
export function getPlannedActionAffectedIdsWithOwners(action: AppAction, context: ProjectContext): string[] {
    const affectedIds = new Set<string>(getPlannedActionAffectedIds(action));
    const payload: Readonly<Record<string, unknown>> = 'payload' in action ? action.payload : {};
    for (const target of proposalCommandShape.targetObjects(action.type, payload)) {
        for (const ownerId of findTargetOwnerTrackIds(target.capability, target.id, context)) {
            affectedIds.add(ownerId);
        }
    }
    return [...affectedIds];
}
