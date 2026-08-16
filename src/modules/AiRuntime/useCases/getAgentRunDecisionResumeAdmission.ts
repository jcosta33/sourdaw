import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type AgentRun, type AgentRunDecision } from '../models/AgentRun';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';

export type AgentRunDecisionResumeAdmission =
    { status: 'admitted'; decision: AgentRunDecision } | { status: 'rejected'; reason: string };

function hasRemainingBudget(run: AgentRun): boolean {
    return Object.entries(run.budgets.limits).every(
        ([category, limit]) => (run.budgets.consumed[category] ?? 0) < limit
    );
}

function hasSameBoundAuthority(run: AgentRun, decision: AgentRunDecision): boolean {
    return (
        JSON.stringify(run.scope) === JSON.stringify(decision.scope) &&
        JSON.stringify(run.grants) === JSON.stringify(decision.grants) &&
        JSON.stringify(run.budgets) === JSON.stringify(decision.budgets)
    );
}

/** Single admission predicate for both the public control surface and a resume attempt. */
export function getAgentRunDecisionResumeAdmission(run: AgentRun | null): AgentRunDecisionResumeAdmission {
    if (
        run === null ||
        run.phase !== 'paused' ||
        run.cancellation.requestedAt !== null ||
        run.decision === null ||
        run.decision.selectedAlternativeId !== null
    ) {
        return { status: 'rejected', reason: 'The pending decision is unavailable or already consumed.' };
    }
    const decision = run.decision;
    if (decision.resumeAttemptId !== null) {
        return { status: 'rejected', reason: 'A replacement planning attempt is already being admitted.' };
    }
    if (captureProjectRevision() !== decision.revision) {
        return { status: 'rejected', reason: 'The project revision changed while the decision was pending.' };
    }
    if (!hasSameBoundAuthority(run, decision)) {
        return {
            status: 'rejected',
            reason: 'The persisted decision authority or budget state no longer matches this run.',
        };
    }
    if (!hasRemainingBudget(run)) {
        return { status: 'rejected', reason: 'The remaining agent budget cannot admit another planning attempt.' };
    }
    if (getPlanningProviderSchemaContract().identity !== decision.capabilitySchemaIdentity) {
        return { status: 'rejected', reason: 'The provider capability schema changed while the decision was pending.' };
    }
    if (decision.alternatives.length === 0) {
        return { status: 'rejected', reason: 'The pending decision has no available alternatives.' };
    }
    return { status: 'admitted', decision };
}
