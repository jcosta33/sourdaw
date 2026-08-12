import { createStore } from '#/infra/store/createStore';

import { type ProjectContextAgentReferenceHistoryEntry } from '../models/ProjectContext';

export type AgentReferenceHistoryState = {
    projectCreatedAt: number | null;
    entries: ProjectContextAgentReferenceHistoryEntry[];
};

export const agentReferenceHistoryStore = createStore<AgentReferenceHistoryState>({
    initialData: { projectCreatedAt: null, entries: [] },
});
