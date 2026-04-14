import { describe, it, expect } from 'vitest';
import * as subject from '../getWorkspaceState';

describe('getWorkspaceState', () => {
    it('should export getWorkspaceState', () => {
        expect(subject.getWorkspaceState).toBeDefined();
        const t = typeof subject.getWorkspaceState;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
