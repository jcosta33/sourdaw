import { describe, it, expect } from 'vitest';
import * as subject from '../getAllVCAGroups';

describe('getAllVCAGroups', () => {
    it('should export getAllVCAGroups', () => {
        expect(subject.getAllVCAGroups).toBeDefined();
        const t = typeof subject.getAllVCAGroups;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
