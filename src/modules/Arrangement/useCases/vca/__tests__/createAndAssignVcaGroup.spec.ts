import { describe, it, expect } from 'vitest';

import * as subject from '../createAndAssignVcaGroup';

describe('createAndAssignVcaGroup', () => {
    it('should export createAndAssignVcaGroup', () => {
        expect(subject.createAndAssignVcaGroup).toBeDefined();
        const time = typeof subject.createAndAssignVcaGroup;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
