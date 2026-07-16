import { describe, it, expect, vi } from 'vitest';

import { resolveDsoNames } from '../resolveDsoNames';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => [
        { id: 't1', name: 'Drums' },
        { id: 't2', name: 'Bass' },
    ],
}));

describe('resolveDsoNames', () => {
    it('resolves track names in DSO targets', () => {
        const dsos = [{ trackId: 't1', action: 'mute' }] as never;
        expect(() => resolveDsoNames(dsos)).not.toThrow();
    });
    it('handles empty DSO list', () => {
        expect(resolveDsoNames([])).toEqual([]);
    });
    it('handles unknown track IDs', () => {
        const dsos = [{ trackId: 'unknown', action: 'solo' }] as never;
        expect(() => resolveDsoNames(dsos)).not.toThrow();
    });
    it('resolves multiple DSOs', () => {
        const dsos = [
            { trackId: 't1', action: 'mute' },
            { trackId: 't2', action: 'solo' },
        ] as never;
        expect(() => resolveDsoNames(dsos)).not.toThrow();
    });
});
