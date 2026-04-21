import { describe, it, expect } from 'vitest';

import * as subject from '../getWorkspaceState';

describe('getWorkspaceState', () => {
    it('should export getWorkspaceState', () => {
        expect(subject.getWorkspaceState).toBeDefined();
        const time = typeof subject.getWorkspaceState;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
