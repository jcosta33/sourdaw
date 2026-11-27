import { type LocalStorageAdapter } from '#/infra/store/storage/createLocalStorage';
import {
    createPartitionedLocalStorage,
    type LocalStoragePartition,
} from '#/infra/store/storage/createPartitionedLocalStorage';
import { isRecord } from '#/utils/structuralEquality';

import { AGENT_RUN_SCHEMA_VERSION, type AgentRun, type AgentRunState } from '../models/AgentRun';

const agentRunPartition: LocalStoragePartition<AgentRunState, Omit<AgentRunState, 'runs'>, AgentRun> = {
    split: ({ runs, ...index }) => ({ index, parts: runs }),
    join: (index, runs) => ({ ...index, runs }),
    identify: (run) => run.runId,
};

/** The backing store for agent runs: one key per run beside an index, read as a reload reads it. */
export function createAgentRunLocalStorage(): LocalStorageAdapter<AgentRunState> {
    return createPartitionedLocalStorage({
        legacyKey: 'sourdaw-agent-runs',
        indexKey: 'sourdaw-agent-runs:index',
        partKeyPrefix: 'sourdaw-agent-runs:run:',
        partition: agentRunPartition,
        preserveSanitizedSourceWhen: (value) =>
            isRecord(value) && 'schemaVersion' in value && value.schemaVersion !== AGENT_RUN_SCHEMA_VERSION,
    });
}
