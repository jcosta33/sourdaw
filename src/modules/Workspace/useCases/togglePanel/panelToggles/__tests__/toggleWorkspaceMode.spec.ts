import { describe, it, expect } from 'vitest';

import * as subject from '../toggleWorkspaceMode';

describe('toggleWorkspaceMode', () => {
    it('should export toggleWorkspaceMode', () => {
        expect(subject.toggleWorkspaceMode).toBeDefined();
        const t = typeof subject.toggleWorkspaceMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
