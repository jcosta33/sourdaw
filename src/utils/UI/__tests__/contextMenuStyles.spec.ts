import { describe, it, expect } from 'vitest';

import { menuBtnClass, menuSepClass, menuShortcutClass } from '../contextMenuStyles';

describe('contextMenuStyles', () => {
    it('should expose menu button classes with hover and layout tokens', () => {
        expect(menuBtnClass).toContain('flex');
        expect(menuBtnClass).toContain('hover:bg-white');
    });

    it('should expose separator and shortcut classes', () => {
        expect(menuSepClass).toContain('border-t');
        expect(menuShortcutClass).toContain('text-muted-foreground');
    });
});
