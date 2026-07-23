import { describe, it, expect } from 'vitest';

import { isNotFoundError } from '../isNotFoundError';
import { toOpfsPath } from '../toOpfsPath';

describe('toOpfsPath', () => {
    it('builds a family/modelId path string', () => {
        expect(toOpfsPath({ family: 'tts', modelId: 'kokoro' })).toBe('tts/kokoro');
    });

    it('handles empty strings', () => {
        expect(toOpfsPath({ family: '', modelId: '' })).toBe('/');
    });

    it('preserves path-like segments in the components', () => {
        expect(toOpfsPath({ family: 'voice/cloned', modelId: 'user/model' })).toBe('voice/cloned/user/model');
    });
});

describe('isNotFoundError', () => {
    it('returns true for a DOMException with name "NotFoundError"', () => {
        const error = new DOMException('Not found', 'NotFoundError');
        expect(isNotFoundError(error)).toBe(true);
    });

    it('returns false for a DOMException with a different name', () => {
        const error = new DOMException('Quota exceeded', 'QuotaExceededError');
        expect(isNotFoundError(error)).toBe(false);
    });

    it('returns false for a generic Error', () => {
        expect(isNotFoundError(new Error('not found'))).toBe(false);
    });

    it('returns false for a string', () => {
        expect(isNotFoundError('NotFoundError')).toBe(false);
    });

    it('returns false for null', () => {
        expect(isNotFoundError(null)).toBe(false);
    });
});
