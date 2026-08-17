import { describe, it, expect } from 'vitest';

import { isStemSeparationAvailable } from '../isStemSeparationAvailable';

describe('isStemSeparationAvailable', () => {
    it('reports stem separation unavailable without an admitted model', () => {
        expect(isStemSeparationAvailable()).toBe(false);
    });
});
