import {
    type AgentRunError,
    type AgentRunErrorCategory,
    type AgentRunErrorRelated,
    type AgentRunErrorRemediation,
} from '../models/AgentRun';

const SAFE_MESSAGES: Record<AgentRunErrorCategory, string> = {
    schema: 'The proposed action was not valid.',
    authorization: 'This action is not authorized for the current run.',
    resolution: 'The requested target could not be resolved.',
    conflict: 'The project changed while this work was pending.',
    project: 'The project could not accept this change.',
    device: 'The requested audio device is unavailable.',
    plugin: 'The requested plugin is unavailable or could not be configured.',
    asset: 'The required asset is unavailable.',
    render: 'Rendering did not complete.',
    analysis: 'Analysis did not complete.',
    provider: 'The model provider could not complete the request.',
    network: 'The network request did not complete.',
    budget: 'This run has reached its available budget.',
    cancellation: 'This run was cancelled before the work completed.',
    internal: 'The application could not safely complete this work.',
};

export type AgentFailureSource = 'provider-planning' | 'command-execution' | 'restart-recovery';

export type AgentFailureInput = {
    category: AgentRunErrorCategory;
    /** Closed vocabulary: provenance only, never an exception or provider payload. */
    source: AgentFailureSource;
    occurredAt?: number;
    related?: Partial<AgentRunErrorRelated>;
    retry?: AgentRunErrorRemediation['retry'];
    compensation?: AgentRunErrorRemediation['compensation'];
    knownDomain?: boolean;
};

/**
 * Canonical, safe failure envelope. Callers deliberately cannot pass provider text
 * or exception messages into the user-facing string.
 */
export function normalizeAgentFailure(input: AgentFailureInput): AgentRunError {
    const retry = input.retry ?? 'never';
    const related = input.related ?? {};
    const compensation = input.compensation ?? 'not-needed';
    let userAction: AgentRunErrorRemediation['userAction'] = 'retry-later';
    if (compensation === 'uncompensated' || compensation === 'manual-repair') {
        userAction = 'manual-repair';
    } else if (input.category === 'conflict') {
        userAction = 'resolve-conflict';
    } else if (retry === 'never') {
        userAction = 'review-scope';
    }
    return {
        code: `agent.${input.category}`,
        message: SAFE_MESSAGES[input.category],
        occurredAt: input.occurredAt ?? Date.now(),
        retriable: retry !== 'never',
        workId: related.workIds?.[0] ?? null,
        category: input.category,
        related: {
            targetIds: [...(related.targetIds ?? [])],
            commandIds: [...(related.commandIds ?? [])],
            workIds: [...(related.workIds ?? [])],
            receiptIdentities: [...(related.receiptIdentities ?? [])],
            artifactIds: [...(related.artifactIds ?? [])],
        },
        remediation: {
            retry,
            userAction,
            compensation,
        },
        cause: { kind: input.knownDomain === false ? 'unknown-internal' : 'known-domain', source: input.source },
    };
}
