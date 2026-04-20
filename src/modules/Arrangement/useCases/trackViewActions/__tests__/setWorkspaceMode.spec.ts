import { describe, it, expect } from 'vitest';

import * as subject from '../setWorkspaceMode';

describe('setWorkspaceMode', () => {
    it('should export setWorkspaceMode', () => {
        expect(subject.setWorkspaceMode).toBeDefined();
        const t = typeof subject.setWorkspaceMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
