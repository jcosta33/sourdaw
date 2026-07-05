import { describe, it, expect } from 'vitest';

import { isStemSeparationAvailable } from '../isStemSeparationAvailable';

describe('isStemSeparationAvailable', () => {
    it('should always report stem separation as available', () => {
        expect(isStemSeparationAvailable()).toBe(true);
    });
});
