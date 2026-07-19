import { describe, expect, it } from 'vitest';

import { classifyGrinderNeuralPersistenceError } from '../classifyGrinderNeuralPersistenceError';

describe('classifyGrinderNeuralPersistenceError', () => {
    it('should classify a QuotaExceededError DOMException as quota_exceeded', () => {
        const result = classifyGrinderNeuralPersistenceError(new DOMException('full', 'QuotaExceededError'));

        expect(result).toEqual({ code: 'quota_exceeded', message: 'full' });
    });

    it.each(['VersionError', 'ConstraintError'])('should classify a %s DOMException as schema_mismatch', (name) => {
        const result = classifyGrinderNeuralPersistenceError(new DOMException('bad schema', name));

        expect(result).toEqual({ code: 'schema_mismatch', message: 'bad schema' });
    });

    it.each(['SecurityError', 'NotAllowedError', 'InvalidStateError'])(
        'should classify a %s DOMException as permission_denied',
        (name) => {
            const result = classifyGrinderNeuralPersistenceError(new DOMException('blocked', name));

            expect(result).toEqual({ code: 'permission_denied', message: 'blocked' });
        }
    );

    it('should classify an unrecognized DOMException name as unknown', () => {
        // This DOMException does not match any recognized-name branch, so it falls through
        // to `error instanceof Error ? error.message : String(error)`. In this runtime
        // DOMException does not extend Error, so it stringifies as "name: message" rather
        // than yielding the bare message text the recognized branches read directly.
        const result = classifyGrinderNeuralPersistenceError(new DOMException('weird', 'AbortError'));

        expect(result).toEqual({ code: 'unknown', message: 'AbortError: weird' });
    });

    it('should fall back to a default message when the DOMException message is empty', () => {
        const result = classifyGrinderNeuralPersistenceError(new DOMException('', 'QuotaExceededError'));

        expect(result).toEqual({ code: 'quota_exceeded', message: 'Storage quota exceeded.' });
    });

    it('should classify a plain Error as unknown, carrying its message through', () => {
        const result = classifyGrinderNeuralPersistenceError(new Error('disk on fire'));

        expect(result).toEqual({ code: 'unknown', message: 'disk on fire' });
    });

    it('should classify a non-Error thrown value as unknown, stringifying it for the message', () => {
        const result = classifyGrinderNeuralPersistenceError('just a string');

        expect(result).toEqual({ code: 'unknown', message: 'just a string' });
    });

    it('should fall back to a default message when a non-Error value stringifies to empty', () => {
        const result = classifyGrinderNeuralPersistenceError('');

        expect(result).toEqual({ code: 'unknown', message: 'Unknown persistence error.' });
    });
});
