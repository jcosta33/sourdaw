import { type HandlerAfterCommit } from '#/utils/handlerContract';

type TransactionScope = <Result>(callback: () => Result) => Result;

/**
 * Runs each aborted action's captured rollback, last attempted first, inside
 * the still-open storage transaction so it sees the state the action saw.
 *
 * A rollback that fails never stops the ones before it: every runtime effect
 * gets its chance to undo, and the failures are returned together as one
 * reason, or `null` when every rollback ran cleanly.
 */
export async function rollbackAbortedActions(
    attemptedActions: readonly { readonly actionType: string; readonly rollback: HandlerAfterCommit | null }[],
    scope: TransactionScope
): Promise<string | null> {
    const failures: string[] = [];
    for (const { actionType, rollback } of [...attemptedActions].reverse()) {
        if (!rollback) {
            continue;
        }
        try {
            await scope(rollback);
        } catch (error) {
            failures.push(`${actionType}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return failures.length > 0 ? failures.join('; ') : null;
}
