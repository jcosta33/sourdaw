import { describe, it, expect } from 'vitest';

import * as subject from '../getMidiRoutingHandlers';

describe('getMidiRoutingHandlers', () => {
    it('should export getMidiRoutingHandlers', () => {
        expect(subject.getMidiRoutingHandlers).toBeDefined();
        const t = typeof subject.getMidiRoutingHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
