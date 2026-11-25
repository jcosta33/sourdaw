import { type AgentReferenceCandidate } from './getAgentReferenceCandidates';

/** Each name every candidate may be stated by, one object per name, as the name reader reads objects. */
export function listAgentReferenceCandidateNames(
    candidates: readonly AgentReferenceCandidate[]
): { id: string; name: string }[] {
    return candidates.flatMap((candidate) => candidate.names.map((name) => ({ id: candidate.id, name })));
}
