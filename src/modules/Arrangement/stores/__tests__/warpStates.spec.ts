import { beforeEach, describe, expect, it } from 'vitest';

import { createWarpMarker, defaultWarpState } from '../../models/WarpMarker';
import {
    __resetWarpStatesForTest,
    addWarpMarker,
    getStoredWarpState,
    getWarpState,
    hasNonDefaultWarpState,
    isDefaultWarpState,
    removeWarpState,
    sanitizeClipWarpStates,
    setAllWarpStates,
    setWarpState,
    warpStateStore,
    warpStates,
} from '../warpStates';

describe('warpStates', () => {
    beforeEach(() => {
        __resetWarpStatesForTest();
    });

    it('setWarpState replaces the state for a clip', () => {
        const state = { enabled: true, markers: [], stretchMode: 'beats' as const, originalTempo: 100 };
        setWarpState('c1', state);
        expect(getWarpState('c1')).toEqual(state);
    });

    it('removeWarpState deletes the entry, falling back to the default afterwards', () => {
        addWarpMarker('c1', 1, 1.2);
        expect(getWarpState('c1').markers).toHaveLength(1);
        expect(warpStates.size).toBe(1);

        removeWarpState('c1');

        expect(warpStates.has('c1')).toBe(false);
        expect(warpStates.size).toBe(0);
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

    it('stores a default warp state as absent', () => {
        setWarpState('c1', { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null });
        expect(getStoredWarpState('c1')).toBeUndefined();
        expect(hasNonDefaultWarpState('c1')).toBe(false);
    });

    it('round-trips non-default markers through sanitize and setAllWarpStates', () => {
        addWarpMarker('clip-a', 1, 1.5);
        const built = Object.entries(warpStateStore.value?.states ?? {}).map(([clipId, state]) => ({
            clipId,
            ...state,
        }));

        __resetWarpStatesForTest();
        addWarpMarker('stale', 9, 9);
        expect(hasNonDefaultWarpState('stale')).toBe(true);

        setAllWarpStates(sanitizeClipWarpStates(built));
        expect(getWarpState('clip-a').markers).toHaveLength(1);
        expect(getWarpState('clip-a').markers[0]?.originalBeat).toBe(1);
        expect(getStoredWarpState('stale')).toBeUndefined();
    });

    it('hydrates an absent or empty field to empty and drops prior in-memory markers', () => {
        addWarpMarker('prior', 2, 2.5);
        setAllWarpStates(sanitizeClipWarpStates(undefined));
        expect(getStoredWarpState('prior')).toBeUndefined();
        expect(Object.keys(warpStateStore.value?.states ?? {})).toEqual([]);

        addWarpMarker('prior', 2, 2.5);
        setAllWarpStates(sanitizeClipWarpStates([]));
        expect(getStoredWarpState('prior')).toBeUndefined();
    });

    describe('isDefaultWarpState', () => {
        it('is true for a state value-identical to defaultWarpState', () => {
            expect(isDefaultWarpState({ ...defaultWarpState })).toBe(true);
            expect(
                isDefaultWarpState({ enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null })
            ).toBe(true);
        });

        it.each([
            ['enabled true', { enabled: true }],
            ['a marker present', { markers: [createWarpMarker(1, 1.2)] }],
            ['a non-default stretch mode', { stretchMode: 'complex' as const }],
            ['a non-null originalTempo', { originalTempo: 120 }],
        ])('is false when the state differs by %s', (_label, overrides) => {
            expect(isDefaultWarpState({ ...defaultWarpState, ...overrides })).toBe(false);
        });
    });

    describe('hasNonDefaultWarpState', () => {
        it('is false for a clip with no store entry', () => {
            expect(hasNonDefaultWarpState('missing-clip')).toBe(false);
        });

        it('is false after writing a value-identical default (stored as absent)', () => {
            setWarpState('c1', { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null });

            expect(warpStates.has('c1')).toBe(false);
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
