import { type PlanningOutcome } from '../models/PlanningOutcome';

/**
 * The user-facing sentence for an outcome that produced no batch but is not a refusal. Shared so a
 * toast and a chat message never phrase the same decline two different ways. Returns `null` for the
 * outcomes that already own their text.
 */
export function describePlanningOutcome(outcome: PlanningOutcome | undefined): string | null {
    if (outcome?.kind === 'unsupported') {
        return `Not supported: ${outcome.reason}`;
    }
    if (outcome?.kind !== 'clarify') {
        return null;
    }
    const numberedQuestions = outcome.questions.map((question, index) => `${String(index + 1)}. ${question}`);
    return [outcome.reason, ...numberedQuestions].join(' ');
}
