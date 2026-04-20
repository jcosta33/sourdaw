import { describe, it, expect } from 'vitest';

import * as subject from '../getArrangementHandlers';

describe('getArrangementHandlers', () => {
    it('should export getArrangementHandlers', () => {
        expect(subject.getArrangementHandlers).toBeDefined();
        const t = typeof subject.getArrangementHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
