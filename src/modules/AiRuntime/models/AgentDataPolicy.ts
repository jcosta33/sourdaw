export const AGENT_DATA_CATEGORIES = [
    'prompt-text',
    'system-instructions',
    'project-context',
    'metadata',
    'midi',
    'lyrics',
    'filename',
    'preset',
    'microphone-audio',
    'raw-audio',
    'render',
    'stem',
    'reference-audio',
    'generated-media',
    'bounce-listening-audio',
] as const;

export type AgentDataCategory = (typeof AGENT_DATA_CATEGORIES)[number];
export type AgentDataRetention = Record<
    'applicationState' | 'abuseMonitoring' | 'promptCache' | 'safetyLegalException' | 'unknown',
    'unknown'
>;
export type AgentDataPolicyDecision = {
    transmission: 'allowed' | 'blocked' | 'local-only';
    blockedCategories: AgentDataCategory[];
    retention: AgentDataRetention;
};

declare const remoteTransmissionDisclosureBrand: unique symbol;
export type RemoteTransmissionDisclosure = { readonly [remoteTransmissionDisclosureBrand]: true };

export const REMOTE_TEXT_AGENT_DATA_CATEGORIES: readonly AgentDataCategory[] = [
    'system-instructions',
    'prompt-text',
    'project-context',
    'metadata',
    'midi',
    'lyrics',
    'filename',
    'preset',
];

const REMOTE_BLOCKED_CATEGORIES = new Set<AgentDataCategory>([
    'microphone-audio',
    'raw-audio',
    'render',
    'stem',
    'reference-audio',
    'generated-media',
    'bounce-listening-audio',
]);
const UNKNOWN_RETENTION: AgentDataRetention = {
    applicationState: 'unknown',
    abuseMonitoring: 'unknown',
    promptCache: 'unknown',
    safetyLegalException: 'unknown',
    unknown: 'unknown',
};

export function classifyAgentDataPolicy(input: {
    destination: 'provider' | 'local';
    categories: readonly AgentDataCategory[];
    modelLabel?: string;
    projectLabel?: string;
}): AgentDataPolicyDecision {
    if (input.destination === 'local') {
        return { transmission: 'local-only', blockedCategories: [], retention: UNKNOWN_RETENTION };
    }
    const blockedCategories = input.categories.filter((category) => REMOTE_BLOCKED_CATEGORIES.has(category));
    return {
        transmission: blockedCategories.length === 0 ? 'allowed' : 'blocked',
        blockedCategories,
        retention: UNKNOWN_RETENTION,
    };
}

export function assertRemoteAgentDataPolicy(categories: readonly AgentDataCategory[]): void {
    const decision = classifyAgentDataPolicy({ destination: 'provider', categories });
    if (decision.transmission === 'blocked') {
        throw new Error(`Remote AI transmission blocked for: ${decision.blockedCategories.join(', ')}`);
    }
}

export function formatRemoteTransmissionDisclosure(categories: readonly AgentDataCategory[]): string {
    return `Privacy disclosure: this hosted AI request sends ${categories.join(', ')}. Provider retention is reported as unknown for application state, abuse monitoring, prompt cache, safety/legal exceptions, and other retention.`;
}
