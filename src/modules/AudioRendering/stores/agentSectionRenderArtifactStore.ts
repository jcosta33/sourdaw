import { createStore } from '#/infra/store/createStore';

import { type AgentSectionRenderArtifact } from '../models/AgentSectionRenderArtifact';

export type AgentSectionRenderArtifactState = {
    artifacts: AgentSectionRenderArtifact[];
};

export const agentSectionRenderArtifactStore = createStore<AgentSectionRenderArtifactState>({
    initialData: { artifacts: [] },
});
