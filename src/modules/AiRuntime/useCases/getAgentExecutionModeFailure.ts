import { AGENT_EXECUTION_MODES, AGENT_TRUST_CEILINGS, type AgentTrustCeiling } from './agentExecutionModes';
import { getAgentExecutionModeAuthority } from './getAgentExecutionModeAuthority';

const trustRank = Object.fromEntries(AGENT_TRUST_CEILINGS.map((mode, index) => [mode, index])) as Record<
    AgentTrustCeiling,
    number
>;

export function getAgentExecutionModeFailure(input: {
    mode: unknown;
    operation: 'plan' | 'preview' | 'commit';
    requiredTrustMode?: unknown;
    trustCeiling: unknown;
}): string | null {
    const mode = AGENT_EXECUTION_MODES.find((candidate) => candidate === input.mode);
    if (!mode) {
        return 'Unsupported agent execution mode';
    }
    const trustCeiling = AGENT_TRUST_CEILINGS.find((candidate) => candidate === input.trustCeiling);
    if (!trustCeiling) {
        return 'Unsupported agent trust ceiling';
    }
    const requiredTrustMode = AGENT_TRUST_CEILINGS.find((candidate) => candidate === input.requiredTrustMode);
    if (input.requiredTrustMode !== undefined && !requiredTrustMode) {
        return 'Unsupported required trust mode';
    }
    const authority = getAgentExecutionModeAuthority(mode);
    if (input.operation === 'plan' && !authority.canPlan) {
        return `Agent execution mode ${mode} cannot plan actions`;
    }
    if (input.operation === 'preview' && !authority.canPreview) {
        return `Agent execution mode ${mode} cannot preview actions`;
    }
    if (input.operation === 'commit' && !authority.canCommit) {
        return `Agent execution mode ${mode} cannot commit actions`;
    }
    if (requiredTrustMode && trustRank[requiredTrustMode] > trustRank[trustCeiling]) {
        return `Required trust mode ${requiredTrustMode} exceeds the ${trustCeiling} ceiling`;
    }
    return null;
}
