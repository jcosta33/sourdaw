import { describe, it, expect } from 'vitest';
import * as subject from '../createAndAssignVcaGroup';

describe('createAndAssignVcaGroup', () => {
    it('should export createAndAssignVcaGroup', () => {
        expect(subject.createAndAssignVcaGroup).toBeDefined();
        const t = typeof subject.createAndAssignVcaGroup;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
