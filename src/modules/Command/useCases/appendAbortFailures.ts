/** Reports the abort cause with whichever compensation or rollback failed to undo its runtime effects. */
export function appendAbortFailures(
    reason: string,
    compensationFailure: string | null,
    rollbackFailure: string | null
): string {
    let result = reason;
    if (compensationFailure) {
        result = `${result}; runtime compensation failed: ${compensationFailure}`;
    }
    if (rollbackFailure) {
        result = `${result}; abort rollback failed: ${rollbackFailure}`;
    }
    return result;
}
