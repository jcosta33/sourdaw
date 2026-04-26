import { describe, it, expect } from 'vitest';

import * as subject from '../toggleWorkspaceMode';

describe('toggleWorkspaceMode', () => {
    it('should export toggleWorkspaceMode', () => {
        expect(subject.toggleWorkspaceMode).toBeDefined();
        const time = typeof subject.toggleWorkspaceMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
