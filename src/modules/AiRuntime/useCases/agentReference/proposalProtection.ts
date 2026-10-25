import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalProtectionFacts } from '../../models/ProposalGroundingBasis';

import { proposalCommandShape } from './proposalCommandShape';

/** The first immutable whole object or facet a grounded command would change. */
function findChange(
    actions: readonly { type: string; payload?: unknown }[],
    facts: ProposalProtectionFacts,
    context: ProjectContext
): { id: string; name: string } | null {
    for (const action of actions) {
        let payload: Record<string, unknown> = {};
        if (typeof action.payload === 'object' && action.payload !== null) {
            payload = Object.fromEntries(Object.entries(action.payload));
        }
        const touched = new Set(proposalCommandShape.touchedObjectIds(action.type, payload, context));
        const whole = facts.protectedUnchanged.find((object) => touched.has(object.id));
        if (whole !== undefined) {
            return whole;
        }
        const owners = new Set(proposalCommandShape.controlOwnerIds(action.type, payload, context));
        const control = facts.protectedControls.find(({ trackId, operations, exceptOperations }) => {
            if (!owners.has(trackId)) {
                return false;
            }
            if (exceptOperations !== undefined) {
                return !exceptOperations.includes(action.type);
            }
            return operations.includes(action.type);
        });
        if (control !== undefined) {
            return {
                id: control.trackId,
                name: context.tracks.find((track) => track.id === control.trackId)?.name ?? control.trackId,
            };
        }
    }
    return null;
}

export const proposalProtection = { findChange };
