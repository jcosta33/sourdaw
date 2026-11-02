import { describe, expect, it } from 'vitest';

import { formatShortcutCombo } from '../formatShortcutCombo';

describe('formatShortcutCombo', () => {
    it.each([
        ['a', 'A'],
        ['mod+shift+a', '⌘ ⇧ A'],
        ['alt+d', '⌥ D'],
        ['mod+alt+shift+k', '⌘ ⌥ ⇧ K'],
        ['Tab', 'Tab'],
        ['+', '+'],
        ['mod++', '⌘ +'],
        ['mod+shift++', '⌘ ⇧ +'],
    ])('renders %s as %s', (combo, expected) => {
        expect(formatShortcutCombo(combo)).toBe(expected);
    });
});
