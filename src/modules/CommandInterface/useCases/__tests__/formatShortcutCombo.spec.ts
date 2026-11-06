import { describe, expect, it } from 'vitest';

import { formatShortcutCombo } from '../formatShortcutCombo';

describe('formatShortcutCombo', () => {
    it.each([
        ['a', 'A'],
        ['mod+shift+a', '⌘ ⇧ A'],
        ['alt+d', '⌥ D'],
        ['shift+alt+mod+k', '⌘ ⌥ ⇧ K'],
        ['Tab', 'Tab'],
        ['Space', 'Space'],
        ['Enter', '⏎'],
        ['mod+Backspace', '⌘ ⌫'],
        ['Delete', 'Del'],
        ['shift+Escape', '⇧ Esc'],
        ['+', '+'],
        ['mod++', '⌘ +'],
        ['mod+shift++', '⌘ ⇧ +'],
    ])('renders %s as %s', (combo, expected) => {
        expect(formatShortcutCombo(combo)).toBe(expected);
    });
});
