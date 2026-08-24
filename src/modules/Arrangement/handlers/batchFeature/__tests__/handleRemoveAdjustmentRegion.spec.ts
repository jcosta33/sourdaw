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
    layers: Array<{
        id: string;
        name: string;
        effectType: AdjustmentLayerSnapshot['effectType'];
        parameters: AdjustmentLayerSnapshot['parameters'];
        affectedTrackIds: string[];
        insertionIndex: number;
        regions: ExpectedRegion[];
        enabled: boolean;
        mix: number;
        color: string;
    }>;
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
        set: (next: MockAdjustmentLayerState | null) => {
            adjustmentLayerState = next;
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
const expectedWrittenRegion: ExpectedRegion = {
    id: 'region-copy',
    startBeat: 48,
    endBeat: 64,
    blend: 0.75,
    fadeInBeats: 0.5,
    fadeOutBeats: 0.25,
};

function createLayer(): MockAdjustmentLayerState['layers'][number] {
    return {
        id: expectedLayer.id,
        name: expectedLayer.name,
        effectType: expectedLayer.effectType,
        parameters: expectedLayer.parameters,
        affectedTrackIds: [...expectedLayer.affectedTrackIds],
        insertionIndex: expectedLayer.insertionIndex,
        regions: [],
        enabled: expectedLayer.enabled,
        mix: expectedLayer.mix,
        color: expectedLayer.color,
    };
}

function createAddAction(): Extract<AppAction, { type: 'addAdjustmentRegion' }> {
    return {
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
    };
}

function createAddCompensation(
    action: Extract<AppAction, { type: 'addAdjustmentRegion' }>
): Extract<AppAction, { type: 'removeAdjustmentRegion' }> {
    const inverseAction = handleAddAdjustmentRegion.describe(action).inverseAction;
    if (inverseAction?.type !== 'removeAdjustmentRegion') {
        throw new Error('Expected addAdjustmentRegion compensation');
    }
    return inverseAction;
}

const compensationHandlers = [handleRemoveAdjustmentRegion, adjustmentLayerHandlers.removeAdjustmentRegion];

describe('handleRemoveAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        adjustmentLayerState = { layers: [createLayer()] };
        trackState = { tracks: [{ id: 'track-bass', frozen: false }] };
    });

    it('forwards both ids', () => {
        handleRemoveAdjustmentRegion.execute({
            type: 'removeAdjustmentRegion',
            payload: { layerId: 'L', regionId: 'R' },
        });
        expect(mocks.removeAdjustmentRegion).toHaveBeenCalledWith('L', 'R');
    });

    it('removes real add output when the guarded region is absent or exactly live', () => {
        const action = createAddAction();
        const compensation = createAddCompensation(action);

        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(true);
        }

        void adjustmentLayerHandlers.addAdjustmentRegion.execute(action);
        expect(adjustmentLayerState?.layers[0].regions[0]).toEqual(expectedWrittenRegion);
        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(true);
        }
        expect(adjustmentLayerHandlers.removeAdjustmentRegion.execute(compensation)).toEqual({ status: 'written' });
        expect(mocks.removeAdjustmentRegion).toHaveBeenCalledWith(expectedLayer.id, expectedWrittenRegion.id);
    });

    it('rejects add compensation after a collaborator changes the guarded region', () => {
        const action = createAddAction();
        const compensation = createAddCompensation(action);
        void adjustmentLayerHandlers.addAdjustmentRegion.execute(action);
        const writtenRegion = adjustmentLayerState?.layers[0].regions[0];
        if (!writtenRegion) {
            throw new Error('Expected the real add execution to write a region');
        }
        writtenRegion.blend = 0.5;

        for (const handler of compensationHandlers) {
            expect(handler.canReapplyAfterDivergence?.(compensation)).toBe(false);
        }
        expect(adjustmentLayerHandlers.removeAdjustmentRegion.execute(compensation)).toEqual({ status: 'conflict' });
        expect(mocks.removeAdjustmentRegion).not.toHaveBeenCalled();
    });
});
