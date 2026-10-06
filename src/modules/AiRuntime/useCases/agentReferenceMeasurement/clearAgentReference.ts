import { emptyAgentReference } from '../../stores/agentReferenceStore';

/** Forget the loaded reference, and any load still measuring: the planner is no longer offered the comparison. */
export function clearAgentReference(): void {
    emptyAgentReference();
}
