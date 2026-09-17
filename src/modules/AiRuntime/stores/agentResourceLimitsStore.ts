import { createStore } from '#/infra/store/createStore';

import { type AgentResourceLimits, DEFAULT_AGENT_RESOURCE_LIMITS } from '../models/AgentResourceLimits';

export const agentResourceLimitsStore = createStore<AgentResourceLimits>({
    initialData: DEFAULT_AGENT_RESOURCE_LIMITS,
});
