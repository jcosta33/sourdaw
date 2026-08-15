import { type AgentExecutionMode } from '../models/AgentExecutionMode';

const executionAuthority = {
    explain: {
        canCommit: false,
        canPlan: false,
        canPreview: false,
        requiresPolicyApproval: false,
        returnsReceipt: false,
    },
    plan: {
        canCommit: false,
        canPlan: true,
        canPreview: false,
        requiresPolicyApproval: false,
        returnsReceipt: false,
    },
    preview: {
        canCommit: false,
        canPlan: true,
        canPreview: true,
        requiresPolicyApproval: true,
        returnsReceipt: false,
    },
    apply: {
        canCommit: true,
        canPlan: true,
        canPreview: false,
        requiresPolicyApproval: true,
        returnsReceipt: true,
    },
    macro: {
        canCommit: true,
        canPlan: true,
        canPreview: false,
        requiresPolicyApproval: true,
        returnsReceipt: true,
    },
} as const satisfies Record<AgentExecutionMode, object>;

export function getAgentExecutionModeAuthority(mode: AgentExecutionMode) {
    return executionAuthority[mode];
}
