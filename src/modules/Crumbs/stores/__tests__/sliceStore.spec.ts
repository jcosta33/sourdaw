import { describe, it, expect, beforeEach } from 'vitest';

import {
    type SliceState,
    sliceStore,
    ensureSliceInstance,
    setMarkers,
    updateMarkerPosition,
    setActiveSlice,
    removeSliceInstance,
} from '../sliceStore';

import type { SliceMarker } from '../../models/CrumbsTypes';

const INSTANCE = 'inst-A';
const OTHER = 'inst-B';

/** Read the instance state, asserting it exists so the test fails loudly if not. */
function readInstance(instanceId = INSTANCE): SliceState {
    const inst = sliceStore.value?.[instanceId];
    if (!inst) {
        throw new Error(`expected instance ${instanceId} to exist`);
    }
    return inst;
}

function marker(id: string, framePosition: number): SliceMarker {
    return { id, framePosition, label: id };
}

describe('ensureSliceInstance', () => {
    beforeEach(() => {
        sliceStore.set({});
    });

    it('seeds a fresh instance with the default slice state', () => {
        ensureSliceInstance(INSTANCE);

        expect(readInstance()).toEqual({
            markers: [],
            activeSliceIndex: 0,
            autoDetected: false,
        });
    });

    it('does not reset an instance that already exists', () => {
        ensureSliceInstance(INSTANCE);
        setMarkers(INSTANCE, [marker('a', 10)], true);

        ensureSliceInstance(INSTANCE);

        expect(readInstance().markers).toHaveLength(1);
        expect(readInstance().autoDetected).toBe(true);
    });
});

describe('setMarkers', () => {
    beforeEach(() => {
        sliceStore.set({});
        ensureSliceInstance(INSTANCE);
    });

    it('replaces the marker list and records the autoDetected flag', () => {
        setMarkers(INSTANCE, [marker('a', 10), marker('b', 20)], true);

        const inst = readInstance();
        expect(inst.markers).toEqual([marker('a', 10), marker('b', 20)]);
        expect(inst.autoDetected).toBe(true);
    });

    it('resets activeSliceIndex to 0 even if a later slice was previously active', () => {
        setMarkers(INSTANCE, [marker('a', 10), marker('b', 20), marker('c', 30)], false);
        setActiveSlice(INSTANCE, 2);
        expect(readInstance().activeSliceIndex).toBe(2);

        setMarkers(INSTANCE, [marker('x', 1)], false);

        expect(readInstance().activeSliceIndex).toBe(0);
    });

    it('is a no-op for an instance that was never created', () => {
        setMarkers(OTHER, [marker('a', 10)], true);

        expect(sliceStore.value?.[OTHER]).toBeUndefined();
    });
});

describe('updateMarkerPosition', () => {
    beforeEach(() => {
        sliceStore.set({});
        ensureSliceInstance(INSTANCE);
        setMarkers(INSTANCE, [marker('a', 10), marker('b', 20), marker('c', 30)], false);
    });

    it('updates the frame position of the matching marker only', () => {
        updateMarkerPosition(INSTANCE, 'b', 25);

        const positions = Object.fromEntries(readInstance().markers.map((m) => [m.id, m.framePosition]));
        expect(positions).toEqual({ a: 10, b: 25, c: 30 });
    });

    it('re-sorts markers by frame position after the move', () => {
        // Drag marker "a" past "b" and "c" — the list must stay in playback order.
        updateMarkerPosition(INSTANCE, 'a', 35);

        expect(readInstance().markers.map((m) => m.id)).toEqual(['b', 'c', 'a']);
    });

    it('leaves state untouched for an id that does not exist', () => {
        const before = readInstance();

        updateMarkerPosition(INSTANCE, 'does-not-exist', 999);

        expect(readInstance().markers).toEqual(before.markers);
    });

    it('is a no-op for an instance that was never created', () => {
        updateMarkerPosition(OTHER, 'a', 5);

        expect(sliceStore.value?.[OTHER]).toBeUndefined();
    });
});

describe('setActiveSlice', () => {
    beforeEach(() => {
        sliceStore.set({});
        ensureSliceInstance(INSTANCE);
        setMarkers(INSTANCE, [marker('a', 10), marker('b', 20)], false);
    });

    it('sets the active index when it is within range', () => {
        setActiveSlice(INSTANCE, 1);

        expect(readInstance().activeSliceIndex).toBe(1);
    });

    it('ignores a negative index, leaving the previous index in place', () => {
        setActiveSlice(INSTANCE, 1);

        setActiveSlice(INSTANCE, -1);

        expect(readInstance().activeSliceIndex).toBe(1);
    });

    it('ignores an index at or past the marker count', () => {
        setActiveSlice(INSTANCE, 1);

        setActiveSlice(INSTANCE, 2);

        expect(readInstance().activeSliceIndex).toBe(1);
    });
});

describe('removeSliceInstance', () => {
    beforeEach(() => {
        sliceStore.set({});
        ensureSliceInstance(INSTANCE);
        ensureSliceInstance(OTHER);
    });

    it('deletes only the targeted instance', () => {
        removeSliceInstance(INSTANCE);

        expect(sliceStore.value?.[INSTANCE]).toBeUndefined();
        expect(sliceStore.value?.[OTHER]).toBeDefined();
    });

    it('is a no-op when the instance does not exist', () => {
        removeSliceInstance('never-existed');

        expect(sliceStore.value?.[INSTANCE]).toBeDefined();
        expect(sliceStore.value?.[OTHER]).toBeDefined();
    });
});
