import { describe, it, expect } from 'vitest';

import * as subject from '../isStemSeparationAvailable';

describe('isStemSeparationAvailable', () => {
    it('should export isStemSeparationAvailable', () => {
        expect(subject.isStemSeparationAvailable).toBeDefined();
        const t = typeof subject.isStemSeparationAvailable;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
