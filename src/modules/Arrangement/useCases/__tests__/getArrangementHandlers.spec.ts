import { describe, it, expect } from 'vitest';

import * as subject from '../getArrangementHandlers';

describe('getArrangementHandlers', () => {
    it('should export getArrangementHandlers', () => {
        expect(subject.getArrangementHandlers).toBeDefined();
        const time = typeof subject.getArrangementHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
