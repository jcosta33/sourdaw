import { type getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';

import { type AgentReferenceCapability } from './isAgentReferenceCapabilityCandidate';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { resolveAgentReference } from './resolveAgentReference';

type AppActionRisk = ReturnType<typeof getAppActionExecutionPolicy>['risk'];

/**
 * The one track a member's whole text names. The canonical resolver must bind it on exact name or
 * literal id evidence, and that name or id must be the member's whole text, so a member never
 * stands for a track whose name it merely contains. The resolver's exact-name evidence alone does
 * not ensure that: it holds for any contained name, and yields to a longer name only when that
 * longer name is itself a candidate track, so a member masked whole as a VCA group's "Bass DI"
 * binds the Bass track in a project with no Bass DI track.
 */
export function resolveWholeMember(input: {
    capability: AgentReferenceCapability;
    context: ProjectContext;
    memberText: string;
    risk: AppActionRisk;
}): string | null {
    const memberText = normalizeAgentReferenceText(input.memberText);
    const resolvedTracks = input.context.tracks.filter((track) => {
        if (
            normalizeAgentReferenceText(track.name) !== memberText &&
            normalizeAgentReferenceText(track.id) !== memberText
        ) {
            return false;
        }
        const result = resolveAgentReference({
            prompt: input.memberText,
            assertedId: track.id,
            capability: input.capability,
            context: input.context,
            risk: input.risk,
        });
        return result.status === 'resolved' && (result.evidence === 'exact-name' || result.evidence === 'literal-id');
    });
    return resolvedTracks.length === 1 ? resolvedTracks[0]!.id : null;
}
