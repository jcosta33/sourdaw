/**
 * Differentiated persistence failure surfaced to callers. Collapsing every
 * IndexedDB failure to `false` hid quota, schema, and permission problems that
 * call for different recovery (free space vs. clear DB vs. grant access).
 *
 * Shared by both persist and restore so the two paths classify IndexedDB
 * DOMExceptions identically without one repository reaching into the other.
 */
export type GrinderNeuralPersistenceErrorCode = 'quota_exceeded' | 'schema_mismatch' | 'permission_denied' | 'unknown';

export type GrinderNeuralPersistenceError = {
    code: GrinderNeuralPersistenceErrorCode;
    message: string;
};

export type GrinderNeuralPersistenceResult = { ok: true } | { ok: false; error: GrinderNeuralPersistenceError };

export function classifyGrinderNeuralPersistenceError(error: unknown): GrinderNeuralPersistenceError {
    if (error instanceof DOMException) {
        if (error.name === 'QuotaExceededError') {
            return { code: 'quota_exceeded', message: error.message || 'Storage quota exceeded.' };
        }
        if (error.name === 'VersionError' || error.name === 'ConstraintError') {
            return { code: 'schema_mismatch', message: error.message || 'Neural library schema mismatch.' };
        }
        if (error.name === 'SecurityError' || error.name === 'NotAllowedError' || error.name === 'InvalidStateError') {
            return { code: 'permission_denied', message: error.message || 'Storage access was denied.' };
        }
    }
    const message = error instanceof Error ? error.message : String(error);
    return { code: 'unknown', message: message || 'Unknown persistence error.' };
}
