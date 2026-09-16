import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { setCompRegion } from '../setCompRegion';

const mocks = vi.hoisted(() => ({
    executeUserAppAction: vi.fn(),
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: mocks.executeUserAppAction,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

function lane(trackId = 'track-1', id = 'lane-1') {
    return {
        ...createTakeLane(trackId),
        id,
        takes: [{ id: 'take-a', clipId: 'clip-a', name: 'A', startBeat: 0, endBeat: 8, selected: true }],
    };
}

describe('setCompRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneStoreValue.value = null;
    });

    it('dispatches valid edits through the user action boundary', () => {
        mocks.takeLaneStoreValue.value = { lanes: [lane()] };

        setCompRegion('track-1', { startBeat: 2, endBeat: 4, takeId: 'take-a' });

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setCompRegion',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-a' },
        });
    });

    it.each([
        ['empty store', null],
        ['missing track', { lanes: [lane('other')] }],
        ['ambiguous track', { lanes: [lane(), lane('track-1', 'lane-2')] }],
        ['missing take', { lanes: [{ ...lane(), takes: [] }] }],
    ] satisfies Array<[string, TakeLaneStoreState | null]>)('does not dispatch for %s', (_name, state) => {
        mocks.takeLaneStoreValue.value = state;

        setCompRegion('track-1', { startBeat: 2, endBeat: 4, takeId: 'take-a' });

        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it.each([
        { startBeat: Number.NaN, endBeat: 4 },
        { startBeat: 2, endBeat: Number.POSITIVE_INFINITY },
        { startBeat: -1, endBeat: 4 },
        { startBeat: 4, endBeat: 4 },
        { startBeat: 5, endBeat: 4 },
    ])('does not dispatch an invalid interval $startBeat..$endBeat', ({ startBeat, endBeat }) => {
        mocks.takeLaneStoreValue.value = { lanes: [lane()] };

        setCompRegion('track-1', { startBeat, endBeat, takeId: 'take-a' });

        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });
});
