import { describe, it, expect, beforeEach } from 'vitest';

import { createWarpMarker, defaultWarpState, type WarpState } from '../../models/WarpMarker';
import {
    addWarpMarker,
    getWarpState,
    hasNonDefaultWarpState,
    isDefaultWarpState,
    removeWarpState,
    setWarpState,
    warpStates,
} from '../warpStates';

describe('warpStates', () => {
    beforeEach(() => {
        warpStates.clear();
    });

    it('setWarpState replaces the state for a clip', () => {
        const state = { enabled: true, markers: [], stretchMode: 'beats' as const, originalTempo: 100 };
        setWarpState('c1', state);
        expect(getWarpState('c1')).toEqual(state);
    });

    it('removeWarpState deletes the entry, falling back to the default afterwards', () => {
        addWarpMarker('c1', 1, 1.2);
        expect(getWarpState('c1').markers).toHaveLength(1);

        removeWarpState('c1');

        // The map entry is gone — getWarpState now returns the shared default.
        expect(warpStates.has('c1')).toBe(false);
        expect(getWarpState('c1')).toBe(defaultWarpState);
    });

    it('removeWarpState leaves other clips untouched', () => {
        addWarpMarker('c1', 1, 1.2);
        addWarpMarker('c2', 2, 2.4);

        removeWarpState('c1');

        expect(warpStates.has('c1')).toBe(false);
        expect(getWarpState('c2').markers).toHaveLength(1);
    });

    it('removeWarpState is a no-op for an unknown clip id', () => {
        addWarpMarker('c1', 1, 1.2);
        expect(() => removeWarpState('nope')).not.toThrow();
        expect(getWarpState('c1').markers).toHaveLength(1);
    });

    describe('isDefaultWarpState', () => {
        it('is true for a state value-identical to defaultWarpState', () => {
            expect(isDefaultWarpState({ ...defaultWarpState })).toBe(true);
            expect(
                isDefaultWarpState({ enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null })
            ).toBe(true);
        });

        it.each<[string, Partial<WarpState>]>([
            ['enabled true', { enabled: true }],
            ['a marker present', { markers: [createWarpMarker(1, 1.2)] }],
            ['a non-default stretch mode', { stretchMode: 'complex' }],
            ['a non-null originalTempo', { originalTempo: 120 }],
        ])('is false when the state differs by %s', (_label, overrides) => {
            expect(isDefaultWarpState({ ...defaultWarpState, ...overrides })).toBe(false);
        });
    });

    describe('hasNonDefaultWarpState', () => {
        it('is false for a clip with no map entry', () => {
            expect(hasNonDefaultWarpState('missing-clip')).toBe(false);
        });

        it('is false for a clip whose entry is value-identical to default (the presence trap)', () => {
            // Mirrors what a write path like `setStretchMode` produces when it
            // writes the mode a clip already has: a map entry exists, but it
            // carries no state a user would recognize as "satellite state".
            setWarpState('c1', { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null });

            expect(warpStates.has('c1')).toBe(true);
            expect(hasNonDefaultWarpState('c1')).toBe(false);
        });

        it('is true for a clip with a real warp marker', () => {
            addWarpMarker('c1', 1, 1.2);
            expect(hasNonDefaultWarpState('c1')).toBe(true);
        });

        it('is true for a clip with enabled: true', () => {
            setWarpState('c1', { enabled: true, markers: [], stretchMode: 'repitch', originalTempo: null });
            expect(hasNonDefaultWarpState('c1')).toBe(true);
        });

        it('is true for a clip with a non-default stretch mode', () => {
            setWarpState('c1', { enabled: false, markers: [], stretchMode: 'complex', originalTempo: null });
            expect(hasNonDefaultWarpState('c1')).toBe(true);
        });
    });
});
