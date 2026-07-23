import { describe, it, expect } from 'vitest';

import { getPluginHostHandlers } from '../getPluginHostHandlers';

describe('getPluginHostHandlers', () => {
    it('returns a map with the scanPlugins handler', () => {
        const map = getPluginHostHandlers();
        expect(Object.keys(map)).toEqual(['scanPlugins']);
    });

    it('the handler is a complete ActionHandler', () => {
        const map = getPluginHostHandlers();
        const handler = map.scanPlugins;
        expect(typeof handler.execute).toBe('function');
        expect(typeof handler.describe).toBe('function');
        expect(typeof handler.undoable).toBe('boolean');
    });

    it('returns a fresh map per call', () => {
        const first = getPluginHostHandlers();
        const second = getPluginHostHandlers();
        expect(first).not.toBe(second);
    });
});
