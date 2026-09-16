/**
 * The hard resource ceilings one agent run may never cross. Every value is a positive integer.
 *
 * `requestChars`, `concurrentRuns` and `runDurationMs` are enforced by the run lifecycle itself:
 * the first two refuse creation, the third refuses further budget reservations. Every remaining
 * category arms the run's budgets at creation, where the reservation path already spends them.
 */
export const AGENT_RESOURCE_LIMIT_CATEGORIES = [
    'requestChars',
    'concurrentRuns',
    'runDurationMs',
    'maxCommands',
    'maxAutomationPoints',
    'maxRenderJobs',
    'maxImportedAssets',
    'maxDeletedObjects',
    'remoteTokens',
    /** Local provider tokens and locally analysed assets share this category at the reservation sites. */
    'localAnalysis',
    'hostedTextPlanningTokens',
    'localTextPlanningTokens',
    'downloadBytes',
    'storageBytes',
] as const;

export type AgentResourceLimitCategory = (typeof AGENT_RESOURCE_LIMIT_CATEGORIES)[number];

export type AgentResourceLimits = Readonly<Record<AgentResourceLimitCategory, number>>;

export const DEFAULT_AGENT_RESOURCE_LIMITS: AgentResourceLimits = {
    requestChars: 65_536,
    concurrentRuns: 4,
    runDurationMs: 30 * 60 * 1000,
    maxCommands: 512,
    maxAutomationPoints: 16_384,
    maxRenderJobs: 64,
    maxImportedAssets: 64,
    maxDeletedObjects: 256,
    remoteTokens: 400_000,
    localAnalysis: 400_000,
    hostedTextPlanningTokens: 400_000,
    localTextPlanningTokens: 400_000,
    downloadBytes: 1024 * 1024 * 1024,
    storageBytes: 1024 * 1024 * 1024,
};

/** Why the lifecycle refused to create a run, named by the resource limit that refused it. */
export type AgentRunCreationRefusalReason = Extract<AgentResourceLimitCategory, 'requestChars' | 'concurrentRuns'>;

export function describeAgentRunCreationRefusal(reason: AgentRunCreationRefusalReason): string {
    return reason === 'requestChars'
        ? 'The request is longer than the configured requestChars limit for one agent run.'
        : 'The configured concurrentRuns limit for agent runs is already reached.';
}
