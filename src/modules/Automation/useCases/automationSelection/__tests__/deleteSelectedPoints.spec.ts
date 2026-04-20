import { describe, it, expect } from 'vitest';

import * as subject from '../deleteSelectedPoints';

describe('deleteSelectedPoints', () => {
    it('should export deleteSelectedPoints', () => {
        expect(subject.deleteSelectedPoints).toBeDefined();
        const t = typeof subject.deleteSelectedPoints;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
