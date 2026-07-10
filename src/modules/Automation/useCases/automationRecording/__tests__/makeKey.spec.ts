import { describe, it, expect } from 'vitest';

import { makeKey } from '../makeKey';

describe('makeKey', () => {
    it('should join track and parameter with double colon', () => {
        expect(makeKey('t1', 'gain')).toBe('t1::gain');
    });
});
