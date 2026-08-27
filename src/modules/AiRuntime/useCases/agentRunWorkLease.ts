import { agentRunLifecycle } from './agentRunLifecycle';

export type ClaimAgentRunWorkLeaseResult = ReturnType<typeof agentRunLifecycle.claimWorkLease>;
export type RetryAgentRunWorkLeaseResult = ReturnType<typeof agentRunLifecycle.retryWorkLease>;
export type SettleAgentRunWorkLeaseResult = ReturnType<typeof agentRunLifecycle.settleWorkLease>;

export const agentRunWorkLease = {
    claim: agentRunLifecycle.claimWorkLease,
    retry: agentRunLifecycle.retryWorkLease,
    settle: agentRunLifecycle.settleWorkLease,
} as const;
