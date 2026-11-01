import { describe, expect, it } from 'vitest';

import {
    getToolShortcutKeys,
    NUMBER_TOOL_SHORTCUTS,
    TOOL_LABELS,
    TOOL_SHORTCUTS,
    type EditingTool,
} from '../EditingTool';

describe('TOOL_SHORTCUTS', () => {
    it('should map keyboard letters to editing tools', () => {
        expect(TOOL_SHORTCUTS.s).toBe('select');
        expect(TOOL_SHORTCUTS.t).toBe('stretch');
    });
});

describe('TOOL_LABELS', () => {
    it('should provide a label for every EditingTool variant', () => {
        const tools: EditingTool[] = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'];
        for (const tool of tools) {
            expect(TOOL_LABELS[tool].length).toBeGreaterThan(0);
        }
    });
});

describe('getToolShortcutKeys', () => {
    it.each<[EditingTool, string[]]>([
        ['select', ['S', '1']],
        ['cut', ['C', '2']],
        ['draw', ['D', 'B', '3']],
        ['automation', ['4']],
        ['stretch', ['T', '5']],
        ['marquee', ['E']],
    ])('lists the keys that select %s, letters first', (tool, keys) => {
        expect(getToolShortcutKeys(tool)).toStrictEqual(keys);
    });

    it('never lists A, which cycles automation visibility instead of selecting a tool', () => {
        const all = (['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'] as const).flatMap(
            getToolShortcutKeys
        );
        expect(all).not.toContain('A');
        expect(TOOL_SHORTCUTS).not.toHaveProperty('a');
    });

    it('covers every entry of both key maps', () => {
        const tools = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'] as const;
        const listed = tools.flatMap(getToolShortcutKeys).sort();
        const mapped = [...Object.keys(TOOL_SHORTCUTS), ...Object.keys(NUMBER_TOOL_SHORTCUTS)]
            .map((key) => key.toUpperCase())
            .sort();
        expect(listed).toStrictEqual(mapped);
    });
});

describe('TOOL_LABELS key hints', () => {
    it('names the letters from TOOL_SHORTCUTS and nothing for a tool with no letter', () => {
        expect(TOOL_LABELS).toStrictEqual({
            select: 'Select (S)',
            cut: 'Cut (C)',
            draw: 'Draw (D/B)',
            automation: 'Auto-draw',
            stretch: 'Stretch (T)',
            marquee: 'Marquee (E)',
        });
    });
});
