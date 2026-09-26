import { createStore } from '#/infra/store/createStore';

import { type AgentMeasurementArtifact } from '../models/AgentMeasurementArtifact';

export type AgentMeasurementArtifactState = {
    artifacts: AgentMeasurementArtifact[];
};

export const agentMeasurementArtifactStore = createStore<AgentMeasurementArtifactState>({
    initialData: { artifacts: [] },
});
