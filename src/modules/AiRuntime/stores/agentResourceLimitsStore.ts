import { createStore } from '#/infra/store/createStore';

import { type AgentResourceLimits, DEFAULT_AGENT_RESOURCE_LIMITS } from '../models/AgentResourceLimits';

export const agentResourceLimitsStore = createStore<AgentResourceLimits>({
    initialData: DEFAULT_AGENT_RESOURCE_LIMITS,
});

/** The configured ceilings, falling back to the defaults while the store holds no value. */
export function readAgentResourceLimits(): AgentResourceLimits {
    return agentResourceLimitsStore.value ?? DEFAULT_AGENT_RESOURCE_LIMITS;
}
