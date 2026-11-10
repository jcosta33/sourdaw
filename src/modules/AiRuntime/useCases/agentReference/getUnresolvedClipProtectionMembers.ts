import { type ProjectContext } from '../../models/ProjectContext';

import { clipProtectionReading, type ReferenceMember } from './clipProtectionReading';

/**
 * The protection list members that resolve to no clip, no track by its exact name and no aggregate
 * control, each with its place in the request, so a caller can read what else a member may name.
 */
export function getUnresolvedClipProtectionMembers(prompt: string, context: ProjectContext): ReferenceMember[] {
    return clipProtectionReading.read(prompt, context).unresolvedMembers;
}
