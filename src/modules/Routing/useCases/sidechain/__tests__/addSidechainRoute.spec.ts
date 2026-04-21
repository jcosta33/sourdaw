import { describe, it, expect } from 'vitest';

import * as subject from '../addSidechainRoute';

describe('addSidechainRoute', () => {
    it('should export addSidechainRoute', () => {
        expect(subject.addSidechainRoute).toBeDefined();
        const time = typeof subject.addSidechainRoute;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
