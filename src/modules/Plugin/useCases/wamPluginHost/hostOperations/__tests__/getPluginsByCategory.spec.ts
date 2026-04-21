import { describe, it, expect, beforeEach } from 'vitest';

import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';

import { getPluginsByCategory } from '../getPluginsByCategory';
import { registry } from '../helpers';
import { registerWAMPlugin } from '../registerWAMPlugin';

function desc(id: string, category: WAMDescriptor['category']): WAMDescriptor {
    return {
        id,
        name: id,
        vendor: 'V',
        version: '1',
        category,
        sdkVersion: '2.0',
    };
}

describe('getPluginsByCategory', () => {
    beforeEach(() => {
        registry.clear();
    });

    it('should return only descriptors matching the category', () => {
        registerWAMPlugin(desc('fx1', 'effect'));
        registerWAMPlugin(desc('inst1', 'instrument'));
        registerWAMPlugin(desc('midi1', 'midi-effect'));
        expect(getPluginsByCategory('effect').map((d) => d.id)).toEqual(['fx1']);
        expect(getPluginsByCategory('instrument').map((d) => d.id)).toEqual(['inst1']);
        expect(getPluginsByCategory('midi-effect').map((d) => d.id)).toEqual(['midi1']);
    });

    it('should return a new array instance each call', () => {
        registerWAMPlugin(desc('a', 'effect'));
        expect(getPluginsByCategory('effect')).not.toBe(getPluginsByCategory('effect'));
    });
});
