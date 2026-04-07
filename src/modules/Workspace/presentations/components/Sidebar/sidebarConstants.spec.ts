import { describe, it, expect } from 'vitest';
import { CATEGORY_COLORS, CATEGORY_ICONS, PRESET_CATEGORIES } from './sidebarConstants';

describe('sidebarConstants', () => {
    it('should expose aligned category keys for icons and colors', () => {
        for (const category of PRESET_CATEGORIES) {
            expect(CATEGORY_ICONS[category]).toBeDefined();
            expect(CATEGORY_COLORS[category]).toMatch(/^bg-/);
        }
    });
});
