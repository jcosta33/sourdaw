import { describe, it, expect } from 'vitest';

import * as subject from '../removeSidechainRoute';

describe('removeSidechainRoute', () => {
    it('should export removeSidechainRoute', () => {
        expect(subject.removeSidechainRoute).toBeDefined();
        const time = typeof subject.removeSidechainRoute;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
