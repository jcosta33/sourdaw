import { describe, expect, it } from 'vitest';

import { CATEGORY_ORDER, PRESET_ACTIONS } from '../Registry';

describe('CATEGORY_ORDER', () => {
    it('is the 11-category display-order tuple', () => {
        expect(CATEGORY_ORDER).toEqual([
            'Transport',
            'Track',
            'Clip',
            'MIDI',
            'Device',
            'Generate',
            'Workspace',
            'Mix',
            'Automation',
            'File',
            'Collaboration',
        ]);
    });

    it('contains every category used by PRESET_ACTIONS', () => {
        const usedCategories = new Set(PRESET_ACTIONS.map((p) => p.category));
        const knownCategories = new Set(CATEGORY_ORDER);
        for (const category of usedCategories) {
            expect(knownCategories.has(category)).toBe(true);
        }
    });
});

describe('PRESET_ACTIONS', () => {
    it('contains presets from every category in CATEGORY_ORDER', () => {
        const presentCategories = new Set(PRESET_ACTIONS.map((p) => p.category));
        for (const category of CATEGORY_ORDER) {
            expect(presentCategories.has(category)).toBe(true);
        }
    });

    it('has unique preset ids', () => {
        const ids = PRESET_ACTIONS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
