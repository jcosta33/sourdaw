import { describe, expect, it } from 'vitest';

import { TOOL_LABELS, TOOL_SHORTCUTS, type EditingTool } from '../EditingTool';

describe('TOOL_SHORTCUTS', () => {
    it('should map keyboard letters to editing tools', () => {
        expect(TOOL_SHORTCUTS.s).toBe('select');
        expect(TOOL_SHORTCUTS.t).toBe('stretch');
    });
});

describe('TOOL_LABELS', () => {
    it('should provide a label for every EditingTool variant', () => {
        const tools: EditingTool[] = ['select', 'cut', 'draw', 'automation', 'stretch'];
        for (const tool of tools) {
            expect(TOOL_LABELS[tool].length).toBeGreaterThan(0);
        }
    });
});
