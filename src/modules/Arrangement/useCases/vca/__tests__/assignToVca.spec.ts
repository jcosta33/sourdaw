import { describe, it, expect } from 'vitest';

import * as subject from '../assignToVca';

describe('assignToVca', () => {
    it('should export assignToVca', () => {
        expect(subject.assignToVca).toBeDefined();
        const time = typeof subject.assignToVca;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
