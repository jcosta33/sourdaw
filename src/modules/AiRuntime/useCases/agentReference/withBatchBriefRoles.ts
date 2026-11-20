import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type ProjectContext } from '../../models/ProjectContext';
import { withBriefRoleContext } from '../vibeRun/withBriefRoleContext';
import { type BriefTrackRole } from '../vibeRun/withBriefTrackRoles';

function readTrackRoles(brief: unknown): BriefTrackRole[] {
    if (!isRecord(brief) || !Array.isArray(brief.trackRoles)) {
        return [];
    }
    const entries: readonly unknown[] = brief.trackRoles;
    const roles: BriefTrackRole[] = [];
    for (const entry of entries) {
        if (isRecord(entry) && typeof entry.trackId === 'string' && typeof entry.role === 'string') {
            roles.push({ trackId: entry.trackId, role: entry.role });
        }
    }
    return roles;
}

/**
 * The project as a batch writing the production brief leaves it: the roles that brief states read onto
 * tracks with none, so a protection of a role family keeps the tracks the brief's vibe run plans in it.
 * A batch writing no brief reads the project as it is.
 */
export function withBatchBriefRoles(context: ProjectContext, actions: readonly AppAction[]): ProjectContext {
    const trackRoles = actions.flatMap((action) =>
        action.type === 'setProductionBrief' ? readTrackRoles(action.payload.brief) : []
    );
    if (trackRoles.length === 0) {
        return context;
    }
    return withBriefRoleContext(context, { trackRoles });
}
