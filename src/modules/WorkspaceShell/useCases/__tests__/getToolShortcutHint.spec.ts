import { describe, expect, it } from 'vitest';

import { getToolShortcutHint } from '../getToolShortcutHint';

describe('getToolShortcutHint', () => {
    it.each([
        ['select', 'S / 1'],
        ['cut', 'C / 2'],
        ['draw', 'D / B / 3'],
        ['automation', '4'],
        ['stretch', 'T / 5'],
        ['marquee', 'E'],
    ] as const)('shows %s as %s', (tool, hint) => {
        expect(getToolShortcutHint(tool)).toBe(hint);
    });
});
