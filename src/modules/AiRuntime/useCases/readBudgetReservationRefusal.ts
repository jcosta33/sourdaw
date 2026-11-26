import { type AgentRun } from '../models/AgentRun';
import { MAX_COLLECTION_LENGTH } from '../models/AgentRunPlanBounds';

/** The category a reservation overspends, or `budgetAttempts` when the run could not read its attempts back. */
export function readBudgetReservationRefusal(
    run: AgentRun,
    newAttemptCount: number,
    additionalByCategory: ReadonlyMap<string, number>
): string | null {
    for (const [category, additional] of additionalByCategory) {
        const limit = run.budgets.limits[category];
        const consumed = run.budgets.consumed[category] ?? 0;
        if (limit !== undefined && consumed + additional > limit) {
            return category;
        }
    }
    return run.budgetAttempts.length + newAttemptCount > MAX_COLLECTION_LENGTH ? 'budgetAttempts' : null;
}
