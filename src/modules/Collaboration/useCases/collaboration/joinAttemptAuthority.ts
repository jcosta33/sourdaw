let currentAttempt = 0;

export const joinAttemptAuthority = {
    begin(): number {
        currentAttempt += 1;
        return currentAttempt;
    },
    invalidate(): void {
        currentAttempt += 1;
    },
    capture(): number {
        return currentAttempt;
    },
    isCurrent(attempt: number): boolean {
        return attempt === currentAttempt;
    },
};
