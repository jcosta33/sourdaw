import { describe, it, expect } from 'vitest';

import * as subject from '../unwireSidechainRoute';

describe('unwireSidechainRoute', () => {
    it('should export unwireSidechainRoute', () => {
        expect(subject.unwireSidechainRoute).toBeDefined();
        const time = typeof subject.unwireSidechainRoute;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
