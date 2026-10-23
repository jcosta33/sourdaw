/**
 * A load that followed another device's upload of the same bank fails when
 * that device's load ends (its processor disposed, its load aborted, its upload
 * refused), though the follower itself was never disposed or aborted. The
 * follower's own load can still succeed on a fresh attempt, so callers load
 * again rather than report a failure.
 */
export class SharedBankOwnerEndedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SharedBankOwnerEndedError';
    }
}

export function isSharedBankOwnerEndedError(error: unknown): error is SharedBankOwnerEndedError {
    return error instanceof SharedBankOwnerEndedError;
}
