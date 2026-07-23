import { describe, it, expect } from 'vitest';

import { getSongStructureHandlers } from '../getSongStructureHandlers';

describe('getSongStructureHandlers', () => {
    it('returns a map with the detectSongStructure handler', () => {
        const map = getSongStructureHandlers();
        expect(Object.keys(map)).toEqual(['detectSongStructure']);
    });

    it('the handler is a complete ActionHandler', () => {
        const map = getSongStructureHandlers();
        const handler = map.detectSongStructure;
        expect(typeof handler.execute).toBe('function');
        expect(typeof handler.describe).toBe('function');
        expect(typeof handler.undoable).toBe('boolean');
    });

    it('returns a fresh map per call', () => {
        const first = getSongStructureHandlers();
        const second = getSongStructureHandlers();
        expect(first).not.toBe(second);
    });
});
