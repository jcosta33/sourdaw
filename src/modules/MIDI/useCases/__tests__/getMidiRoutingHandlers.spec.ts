import { describe, it, expect } from 'vitest';

import * as subject from '../getMidiRoutingHandlers';

describe('getMidiRoutingHandlers', () => {
    it('should export getMidiRoutingHandlers', () => {
        expect(subject.getMidiRoutingHandlers).toBeDefined();
        const time = typeof subject.getMidiRoutingHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
