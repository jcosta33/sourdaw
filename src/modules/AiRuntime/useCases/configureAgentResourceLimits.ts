import {
    AGENT_RESOURCE_LIMIT_CATEGORIES,
    type AgentResourceLimitCategory,
    type AgentResourceLimits,
    DEFAULT_AGENT_RESOURCE_LIMITS,
} from '../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../stores/agentResourceLimitsStore';

export type ConfigureAgentResourceLimitsResult =
    | { status: 'configured'; limits: AgentResourceLimits }
    | { status: 'rejected'; reason: 'invalid-limit'; category: AgentResourceLimitCategory };

/**
 * Replaces the named ceilings and leaves the rest standing. A limit that is not a positive integer
 * is refused whole: the first offending category in declaration order is reported and nothing is
 * written, so a partially applied configuration can never arm a run.
 */
export function configureAgentResourceLimits(update: Partial<AgentResourceLimits>): ConfigureAgentResourceLimitsResult {
    const limits: Record<AgentResourceLimitCategory, number> = structuredClone(
        agentResourceLimitsStore.value ?? DEFAULT_AGENT_RESOURCE_LIMITS
    );
    for (const category of AGENT_RESOURCE_LIMIT_CATEGORIES) {
        const value = update[category];
        if (value === undefined) {
            continue;
        }
        if (!Number.isSafeInteger(value) || value <= 0) {
            return { status: 'rejected', reason: 'invalid-limit', category };
        }
        limits[category] = value;
    }
    agentResourceLimitsStore.set(limits);
    return { status: 'configured', limits };
}
