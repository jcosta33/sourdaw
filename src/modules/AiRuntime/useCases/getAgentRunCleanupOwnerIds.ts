import { readAgentRunState } from '../stores/agentRunStore';

/** Capture persisted AI operation identities whose staged resources cannot survive renderer restart. */
export function getAgentRunCleanupOwnerIds(): string[] {
    return readAgentRunState().runs.map((run) => run.runId);
}
