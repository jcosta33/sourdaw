/** A correction can only consume already-reserved capacity; it never broadens run authority. */
export function admitBoundedAgentCorrection(input: {
    attempt: number;
    maxAttempts: number;
    reservedBudgetAvailable: boolean;
    cancellationRequested: boolean;
    stale: boolean;
    sameRevision: boolean;
    sameScope: boolean;
    sameGrants: boolean;
}): boolean {
    return (
        input.attempt < input.maxAttempts &&
        input.reservedBudgetAvailable &&
        !input.cancellationRequested &&
        !input.stale &&
        input.sameRevision &&
        input.sameScope &&
        input.sameGrants
    );
}
