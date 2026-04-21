import { describe, it, expect } from 'vitest';

import * as subject from '../getVersionCount';

describe('getVersionCount', () => {
    it('should export getVersionCount', () => {
        expect(subject.getVersionCount).toBeDefined();
        const time = typeof subject.getVersionCount;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
