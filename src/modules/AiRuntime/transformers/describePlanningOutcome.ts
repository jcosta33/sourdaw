import { type PlanningOutcome } from '../models/PlanningOutcome';

/**
 * A run that searched the catalog and matched nothing says so. Without its own sentence it fell
 * through to the caller's fallback, which also stands in for an outcome that never arrived — so a
 * decided "nothing matched" and a missing decision read identically to the user.
 */
export const NO_MATCH_PLANNING_OUTCOME_TEXT = 'No command matched the request.';

/**
 * The user-facing sentence for an outcome that produced no batch but is not a refusal. Shared so a
 * toast and a chat message never phrase the same decline two different ways. Returns `null` for the
 * outcomes that already own their text.
 */
export function describePlanningOutcome(outcome: PlanningOutcome | undefined): string | null {
    if (outcome?.kind === 'unsupported') {
        const searched =
            outcome.searchedIntents.length === 0 ? [] : [`Searched: ${outcome.searchedIntents.join(', ')}`];
        return [`Not supported: ${outcome.reason}`, ...searched].join(' ');
    }
    if (outcome?.kind === 'no-match') {
        return NO_MATCH_PLANNING_OUTCOME_TEXT;
    }
    if (outcome?.kind !== 'clarify') {
        return null;
    }
    const numberedQuestions = outcome.questions.map((question, index) => `${String(index + 1)}. ${question}`);
    return [outcome.reason, ...numberedQuestions].join(' ');
}
