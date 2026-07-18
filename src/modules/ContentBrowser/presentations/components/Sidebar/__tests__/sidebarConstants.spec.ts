import { describe, it, expect } from 'vitest';

import { CATEGORY_COLORS, CATEGORY_ICONS, PRESET_CATEGORIES } from '../sidebarConstants';

describe('sidebarConstants', () => {
    it('should expose aligned category keys for icons and colors', () => {
        for (const category of PRESET_CATEGORIES) {
            expect(CATEGORY_ICONS[category]).toBeDefined();
            expect(CATEGORY_COLORS[category]).toMatch(/^bg-/);
        }
    });

    it('should use the same key set for categories, icons, and colors', () => {
        const fromList = [...PRESET_CATEGORIES].sort();
        const fromIcons = Object.keys(CATEGORY_ICONS).sort();
        const fromColors = Object.keys(CATEGORY_COLORS).sort();
        expect(fromIcons).toEqual(fromColors);
        expect(fromList).toEqual(fromIcons);
    });

    it('should map every category to a Lucide icon component', () => {
        for (const category of PRESET_CATEGORIES) {
            const Icon = CATEGORY_ICONS[category];
            expect(Icon).toBeTruthy();
            // Lucide exports may be `function` or `object` (e.g. forwardRef) depending on bundler/react version
            expect(['function', 'object']).toContain(typeof Icon);
        }
    });
});
