import { describe, it, expect, beforeEach } from 'vitest';

import { defaultWarpState } from '../../models/WarpMarker';
import { addWarpMarker, getWarpState, removeWarpState, setWarpState, warpStates } from '../warpStates';

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
});
