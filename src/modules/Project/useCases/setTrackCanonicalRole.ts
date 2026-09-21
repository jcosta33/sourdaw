import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { CANONICAL_TRACK_ROLES } from '../models/CanonicalTrackRole';
import { projectStore } from '../stores/projectStore';

type Input = { trackId: string; role: string | null; expectedRevision: number };

/** Replace only this track's authored entries; null restores automatic role derivation. */
export async function setTrackCanonicalRole(input: Input): Promise<void> {
    const project = projectStore.value;
    const projectIdentity = captureProjectIdentity();
    if (!project || !trackStore.value?.tracks.some((track) => track.id === input.trackId)) {
        throw new Error('The track is no longer available.');
    }
    if (project.productionBrief.revision !== input.expectedRevision) {
        throw new Error('Production brief changed; try again.');
    }
    const role = CANONICAL_TRACK_ROLES.find((candidate) => candidate === input.role);
    if (input.role !== null && !role) {
        throw new Error('Unsupported track role.');
    }
    const brief = structuredClone(project.productionBrief);
    const now = Math.max(Date.now(), brief.updatedAt);
    brief.trackRoles = brief.trackRoles.filter((entry) => entry.trackId !== input.trackId);
    if (role) {
        brief.trackRoles.push({ id: `role-${crypto.randomUUID()}`, trackId: input.trackId, role, createdAt: now });
    }
    brief.revision += 1;
    brief.updatedAt = now;
    await executeAppAction(
        { type: 'setProductionBrief', payload: { expectedRevision: input.expectedRevision, brief } },
        {
            // Command can wait behind a snapshot. Revalidate the captured owner at admission,
            // before the handler captures undo or writes a brief into a replacement project.
            shouldExecute: () => {
                const current = projectStore.value;
                if (captureProjectIdentity() !== projectIdentity || current?.projectId !== project.projectId) {
                    throw new Error('The project changed; select the track again.');
                }
                if (!trackStore.value?.tracks.some((track) => track.id === input.trackId)) {
                    throw new Error('The track is no longer available.');
                }
                if (current?.productionBrief.revision !== input.expectedRevision) {
                    throw new Error('Production brief changed; try again.');
                }
                return true;
            },
        }
    );
}
