import { describe, it, expect } from 'vitest';
import { createDecodeError } from '../DecodeError';

describe('createDecodeError', () => {
    it('should create an AppError tagged Decode with the given message', () => {
        const err = createDecodeError('bad frame');

        expect(err._tag).toBe('Decode');
        expect(err.message).toBe('bad frame');
    });
});
