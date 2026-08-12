import { createStore } from '#/infra/store/createStore';

import { type ProjectContextAgentReferenceHistoryEntry } from '../models/ProjectContext';

export const agentReferenceHistoryStore = createStore<ProjectContextAgentReferenceHistoryEntry[]>({
    initialData: [],
});
