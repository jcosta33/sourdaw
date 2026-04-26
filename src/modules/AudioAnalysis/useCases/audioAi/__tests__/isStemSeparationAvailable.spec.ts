import { describe, it, expect } from 'vitest';

import * as subject from '../isStemSeparationAvailable';

describe('isStemSeparationAvailable', () => {
    it('should export isStemSeparationAvailable', () => {
        expect(subject.isStemSeparationAvailable).toBeDefined();
        const time = typeof subject.isStemSeparationAvailable;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
