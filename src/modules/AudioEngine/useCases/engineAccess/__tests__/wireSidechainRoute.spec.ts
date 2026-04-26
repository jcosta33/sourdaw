import { describe, it, expect } from 'vitest';

import * as subject from '../wireSidechainRoute';

describe('wireSidechainRoute', () => {
    it('should export wireSidechainRoute', () => {
        expect(subject.wireSidechainRoute).toBeDefined();
        const time = typeof subject.wireSidechainRoute;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
