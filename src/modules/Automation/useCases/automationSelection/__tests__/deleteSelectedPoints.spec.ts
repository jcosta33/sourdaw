import { describe, it, expect } from 'vitest';

import * as subject from '../deleteSelectedPoints';

describe('deleteSelectedPoints', () => {
    it('should export deleteSelectedPoints', () => {
        expect(subject.deleteSelectedPoints).toBeDefined();
        const time = typeof subject.deleteSelectedPoints;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
