import { describe, it, expect, beforeEach } from 'vitest';

import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';

import { getRegisteredPlugins } from '../getRegisteredPlugins';
import { registry } from '../helpers';
import { registerWAMPlugin } from '../registerWAMPlugin';

const desc = (id: string): WAMDescriptor => ({
    id,
    name: id,
    vendor: 'V',
    version: '1',
    category: 'effect',
    sdkVersion: '2.0',
});

describe('getRegisteredPlugins', () => {
    beforeEach(() => {
        registry.clear();
    });

    it('should return all registered descriptors as a new array', () => {
        registerWAMPlugin(desc('a'));
        registerWAMPlugin(desc('b'));
        const a = getRegisteredPlugins();
        const b = getRegisteredPlugins();
        expect(a).toHaveLength(2);
        expect(a).not.toBe(b);
        expect(a.map((d) => d.id).sort()).toEqual(['a', 'b']);
    });

    it('should return an empty array when nothing is registered', () => {
        expect(getRegisteredPlugins()).toEqual([]);
    });
});
