import { describe, expect, it } from 'vitest';

import { migrateStoredShortcutCombo } from '../ShortcutCombo';

describe('migrateStoredShortcutCombo', () => {
    it.each([
        ['alt+∂', 'alt+d'],
        ['alt+ß', 'alt+s'],
        ['alt+‘', 'alt+]'],
        ['alt+“', 'alt+['],
        ['alt+Ω', 'alt+z'],
        ['alt+¡', 'alt+1'],
        ['shift+!', 'shift+1'],
        ['shift+<', 'shift+,'],
        ['mod+shift+_', 'mod+shift+-'],
        ['mod+shift+alt+˚', 'mod+shift+alt+k'],
        ['shift+alt+@', 'shift+alt+2'],
    ])('rewrites %s to %s', (stored, migrated) => {
        expect(migrateStoredShortcutCombo(stored)).toBe(migrated);
    });

    it.each([
        ['an unknown dead key', 'alt+Dead'],
        ['a shifted symbol without Shift', '!'],
        ['an Option character without Alt', 'shift+∂'],
        ['the zoom-in plus key with Shift', 'mod+shift++'],
        ['the bare plus key', '+'],
        ['a plain letter', 'm'],
        ['a modified letter in its stored case', 'shift+D'],
        ['a named key', 'shift+Escape'],
    ])('leaves %s unchanged', (_label, stored) => {
        expect(migrateStoredShortcutCombo(stored)).toBe(stored);
    });
});
