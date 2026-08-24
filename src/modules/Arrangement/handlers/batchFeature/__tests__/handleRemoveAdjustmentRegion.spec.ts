import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayerSnapshot, type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerHandlers } from '../adjustmentLayerHandlers';
import { handleAddAdjustmentRegion } from '../handleAddAdjustmentRegion';
import { handleRemoveAdjustmentRegion } from '../handleRemoveAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    removeAdjustmentRegion: vi.fn(),
}));

type ExpectedRegion = NonNullable<Extract<AppAction, { type: 'removeAdjustmentRegion' }>['payload']['expectedRegion']>;
type MockAdjustmentLayerState = {
    layers: Array<{ id: string; regions: ExpectedRegion[] }>;
};
type MockTrackState = {
    tracks: Array<{ id: string; frozen: boolean }>;
};

let adjustmentLayerState: MockAdjustmentLayerState | null = null;
let trackState: MockTrackState | null = null;

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return adjustmentLayerState;
        },
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return trackState;
        },
    },
}));

vi.mock('../../../useCases/adjustmentLayer/removeAdjustmentRegion', () => ({
    removeAdjustmentRegion: mocks.removeAdjustmentRegion,
}));

const expectedLayer: AdjustmentLayerSnapshot = {
    id: 'layer-1',
    name: 'Bass EQ',
    effectType: 'eq',
    parameters: [],
    affectedTrackIds: ['track-bass'],
    insertionIndex: 0,
    regions: [],
    enabled: true,
    mix: 1,
    color: '#fff',
};

function createAddCompensation(): Extract<AppAction, { type: 'removeAdjustmentRegion' }> {
    const inverseAction = handleAddAdjustmentRegion.describe({
        type: 'addAdjustmentRegion',
        payload: {
            layerId: expectedLayer.id,
            startBeat: 48,
            endBeat: 64,
            blend: 0.75,
            fadeInBeats: 0.5,
            fadeOutBeats: 0.25,
            regionId: 'region-copy',
            expectedLayer,
            expectedTracks: [{ trackId: 'track-bass', trackName: 'Bass', frozen: false }],
        },
    }).inverseAction;
    if (inverseAction?.type !== 'removeAdjustmentRegion') {
        throw new Error('Expected addAdjustmentRegion compensation');
    }
    return inverseAction;
}

const compensationHandlers = [handleRemoveAdjustmentRegion, adjustmentLayerHandlers.removeAdjustmentRegion];

describe('handleRemoveAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        adjustmentLayerState = { layers: [{ id: expectedLayer.id, regions: [] }] };
        trackState = { tracks: [{ id: 'track-bass', frozen: false }] };
    });

    it('forwards both ids', () => {
        handleRemoveAdjustmentRegion.execute({
            type: 'removeAdjustmentRegion',
            payload: { layerId: 'L', regionId: 'R' },
        });
        expect(mocks.removeAdjustmentRegion).toHaveBeenCalledWith('L', 'R');
    });

    it('certifies add compensation before and after the guarded region is written', () => {
        const compensation = createAddCompensation();

        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(true);
        }

        adjustmentLayerState = {
            layers: [{ id: expectedLayer.id, regions: [compensation.payload.expectedRegion] }],
        };
        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(true);
        }
    });

    it('rejects add compensation after a collaborator changes the guarded region', () => {
        const compensation = createAddCompensation();
        adjustmentLayerState = {
            layers: [
                {
                    id: expectedLayer.id,
                    regions: [{ ...compensation.payload.expectedRegion, blend: 0.5 }],
                },
            ],
        };

        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(false);
        }
    });
});
