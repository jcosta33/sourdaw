import { describe, it, expect } from 'vitest';

import { classifyScanError } from '../classifyScanError';

describe('classifyScanError', () => {
    it('classifies a lost-permission DOMException as permission_required', () => {
        const error = new DOMException('denied', 'NotAllowedError');

        const result = classifyScanError(error, 'Samples');

        expect(result).toEqual({
            status: 'permission_required',
            message: 'Lost permission to read "Samples". Reconnect the folder to rescan.',
        });
    });

    it('classifies a SecurityError DOMException as permission_required', () => {
        const error = new DOMException('blocked', 'SecurityError');

        const result = classifyScanError(error, 'Drums');

        expect(result.status).toBe('permission_required');
    });

    it('classifies a NotFoundError as an offline missing-folder message', () => {
        const error = new DOMException('missing', 'NotFoundError');

        const result = classifyScanError(error, 'Vocals');

        expect(result).toEqual({
            status: 'offline',
            message: 'The folder "Vocals" could not be found. It may have been moved or removed.',
        });
    });

    it('classifies an unrecognized Error name as a generic offline filesystem error', () => {
        const error = new Error('boom');

        const result = classifyScanError(error, 'Loops');

        expect(result).toEqual({
            status: 'offline',
            message: 'Could not scan "Loops" — a filesystem error occurred.',
        });
    });

    it('classifies a non-Error, non-DOMException throw as a generic offline error', () => {
        const result = classifyScanError('a plain string rejection', 'Kicks');

        expect(result).toEqual({
            status: 'offline',
            message: 'Could not scan "Kicks" — a filesystem error occurred.',
        });
    });
});
