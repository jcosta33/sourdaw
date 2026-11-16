import { type ProjectContext } from '../../models/ProjectContext';

import { type BriefTrackRole, withBriefTrackRoles } from './withBriefTrackRoles';

/** The project as the brief about to be written reads it: its track roles projected onto tracks with none. */
export function withBriefRoleContext(
    context: ProjectContext,
    brief: { trackRoles: readonly BriefTrackRole[] }
): ProjectContext {
    return { ...context, tracks: withBriefTrackRoles(context.tracks, brief) };
}
