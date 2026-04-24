import { describe, it, expect } from 'vitest';

import * as subject from '../setWorkspaceMode';

describe('setWorkspaceMode', () => {
    it('should export setWorkspaceMode', () => {
        expect(subject.setWorkspaceMode).toBeDefined();
        const time = typeof subject.setWorkspaceMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
