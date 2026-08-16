import { type AgentRunSagaStep } from '../models/AgentRun';

export function createAgentSagaStep(
    input: Omit<AgentRunSagaStep, 'compensation'> & { compensationAvailable: boolean }
): AgentRunSagaStep {
    return {
        ...input,
        relatedArtifactIds: [...input.relatedArtifactIds],
        compensation: { available: input.compensationAvailable, attempts: 0, lastError: null },
    };
}
