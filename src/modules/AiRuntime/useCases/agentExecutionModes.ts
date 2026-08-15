export const AGENT_EXECUTION_MODES = ['explain', 'plan', 'preview', 'apply', 'macro'] as const;

export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number];

export const AGENT_TRUST_CEILINGS = [
    'analyze-only',
    'create-branch',
    'apply-reversible',
    'replace-selection',
    'destructive-commit',
] as const;

export type AgentTrustCeiling = (typeof AGENT_TRUST_CEILINGS)[number];
