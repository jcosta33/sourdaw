import { type AgentRunCommandBatchAuthority } from '../models/AgentRun';

function normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, normalizeJson(nested)])
    );
}

export function hasExactAgentCommandBatchAuthority(
    expected: AgentRunCommandBatchAuthority,
    candidate: AgentRunCommandBatchAuthority
): boolean {
    return JSON.stringify(normalizeJson(candidate)) === JSON.stringify(normalizeJson(expected));
}
