import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerFades } from '../setLayerFades';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: { layers: unknown[] } | null } = { value: { layers: [] } };
    return {
        adjustmentLayerStoreValue,
        adjustmentLayerStoreSet: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

type FadeRegion = { id: string; startBeat?: number; endBeat?: number; fadeInBeats: number; fadeOutBeats: number };
type FadeLayer = { id: string; regions: FadeRegion[] };
type FadeState = { layers: FadeLayer[] };

function firstRegion(setCall: unknown): FadeRegion {
    const state = setCall as FadeState;
    const region = state.layers[0]?.regions[0];
    if (!region) {
        throw new Error('expected a region in the set state');
    }
    return region;
}

describe('setLayerFades', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates fade-in and fade-out values on the matching region', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    regions: [{ id: 'r1', startBeat: 0, endBeat: 4, fadeInBeats: 0.25, fadeOutBeats: 0.25 }],
                },
            ],
        };

        setLayerFades('r1', 1, 2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const region = firstRegion(setCall[0]);
        expect(region.fadeInBeats).toBe(1);
        expect(region.fadeOutBeats).toBe(2);
    });

    it('clamps negative fade values to zero', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1', fadeInBeats: 1, fadeOutBeats: 1 }] }],
        };

        setLayerFades('r1', -1, -2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const region = firstRegion(setCall[0]);
        expect(region.fadeInBeats).toBe(0);
        expect(region.fadeOutBeats).toBe(0);
    });

    it('leaves layers untouched when no region matches the id', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1', startBeat: 0, endBeat: 4, fadeInBeats: 1, fadeOutBeats: 1 }] }],
        };

        setLayerFades('nonexistent', 5, 5);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        // the layer is returned unchanged because no region matched
        const region = firstRegion(setCall[0]);
        expect(region.fadeInBeats).toBe(1);
        expect(region.fadeOutBeats).toBe(1);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        setLayerFades('r1', 1, 2);

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });

    it('updates only the matching region and leaves sibling regions on the same layer untouched', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    regions: [
                        { id: 'r1', startBeat: 0, endBeat: 4, fadeInBeats: 0.25, fadeOutBeats: 0.25 },
                        { id: 'r2', startBeat: 4, endBeat: 8, fadeInBeats: 0.5, fadeOutBeats: 0.5 },
                    ],
                },
            ],
        };

        setLayerFades('r1', 1, 2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to be called');
        }
        const state = setCall[0] as FadeState;
        const regions = state.layers[0]!.regions;
        expect(regions[0]).toMatchObject({ id: 'r1', fadeInBeats: 1, fadeOutBeats: 2 });
        // Sibling region passes through unchanged.
        expect(regions[1]).toMatchObject({ id: 'r2', fadeInBeats: 0.5, fadeOutBeats: 0.5 });
    });
});
