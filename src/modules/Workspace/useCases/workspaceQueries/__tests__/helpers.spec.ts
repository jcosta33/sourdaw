import { describe, expect, it } from 'vitest';

import { TOOL_SHORTCUTS } from '../helpers';

describe('workspaceQueries helpers', () => {
    it('should map editing tool shortcuts', () => {
        expect(TOOL_SHORTCUTS.s).toBe('select');
        expect(TOOL_SHORTCUTS.c).toBe('cut');
        expect(TOOL_SHORTCUTS.d).toBe('draw');
        expect(TOOL_SHORTCUTS.b).toBe('draw');
        expect(TOOL_SHORTCUTS.t).toBe('stretch');
    });
});
