import { describe, expect, it } from 'vitest';

import { menuBtnClass, menuSepClass, menuShortcutClass } from '../contextMenuStyles';

describe('contextMenuStyles', () => {
    it('should expose shared Tailwind utility strings for context menus', () => {
        expect(menuBtnClass.length).toBeGreaterThan(0);
        expect(menuBtnClass).toContain('flex');
        expect(menuSepClass).toContain('border');
        expect(menuShortcutClass).toContain('ml-auto');
    });
});
