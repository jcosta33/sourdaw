import { parse } from 'superjson';

import { type AgentRunGrants, type AgentRunPlan, type AgentRunScope, type AgentRunState } from '../../models/AgentRun';
import { sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';

export const RUN_ID = 'restore-bound-run';
export const STORAGE_KEY = 'sourdaw-agent-runs';

export const scope: AgentRunScope = {
    targetIds: ['track-1'],
    targetRanges: [],
    protectedTargetIds: [],
    protectedRanges: [],
};
export const grants: AgentRunGrants = {
    allowedOperationPrefixes: [],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
export const budgets = { limits: {}, consumed: {} };

export function createRun(): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Brighten the vocal.',
        mode: 'plan',
        createdRevision: 'revision-1',
    });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Brighten the vocal.',
        commandIds: [],
        serializedBatchIdentity: null,
        revision: 'revision-1',
        scope,
        grants,
        budgets,
    });
}

export function liveRun() {
    const run = agentRunLifecycle.get(RUN_ID);
    if (run?.plan === null || run?.plan === undefined) {
        throw new Error('Expected the recorded run plan.');
    }
    return { run, plan: run.plan };
}

/** What the next session reads from the stored text, decoded and sanitized exactly as the store loads it. */
export function decodeReloadedRun(raw: string | null) {
    if (raw === null) {
        throw new Error('Expected persisted agent run state.');
    }
    const state: AgentRunState = sanitizeAgentRunState(parse<unknown>(raw));
    const run = state.runs.find((candidate) => candidate.runId === RUN_ID);
    if (run === undefined) {
        throw new Error('The run did not survive the reload.');
    }
    return run;
}

export function planRecord(
    plan: AgentRunPlan,
    overrides: Partial<{ scope: AgentRunScope; grants: AgentRunGrants }> = {}
) {
    return {
        runId: RUN_ID,
        summary: plan.summary,
        commandIds: plan.commandIds,
        serializedBatchIdentity: plan.serializedBatchIdentity,
        revision: 'revision-2',
        scope,
        grants,
        budgets,
        plan,
        ...overrides,
    };
}

export function ids(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`);
}
