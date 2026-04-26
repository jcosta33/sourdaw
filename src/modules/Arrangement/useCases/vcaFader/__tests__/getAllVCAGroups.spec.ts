import { describe, it, expect } from 'vitest';

import * as subject from '../getAllVCAGroups';

describe('getAllVCAGroups', () => {
    it('should export getAllVCAGroups', () => {
        expect(subject.getAllVCAGroups).toBeDefined();
        const time = typeof subject.getAllVCAGroups;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
