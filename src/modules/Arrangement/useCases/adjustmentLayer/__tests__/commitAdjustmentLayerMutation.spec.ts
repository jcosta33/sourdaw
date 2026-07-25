import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { type TrackStoreState, type Track } from '../../../stores/trackStore';
import { commitAdjustmentLayerMutation } from '../commitAdjustmentLayerMutation';

type InversePayload = {
    expectedLayersFingerprint: string;
    freezeTransitions: Array<{ trackId: string; previousStatus: 'frozen'; expectedSourceSignature: string }>;
};

const mocks = vi.hoisted(() => ({
    layerValue: { value: null as AdjustmentLayerState | null },
    layerSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
    trackValue: { value: null as TrackStoreState | null },
    trackSet: vi.fn<(value: TrackStoreState | null) => void>(),
}));

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.layerValue.value;
        },
        set: mocks.layerSet,
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackValue.value;
        },
        set: mocks.trackSet,
    },
}));

function makeFrozenTrack(id: string): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        clips: [
            {
                id: `${id}-clip`,
                trackId: id,
                name: 'c',
                startBeat: 0,
                endBeat: 4,
                type: 'audio',
                assetHash: 'hash',
                gain: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                color: '',
                locked: false,
                muted: false,
            },
        ],
        devices: [{ id: 'd1', type: 'gain', parameterValues: { gain: 1 }, bypassed: false }],
        freezeState: { status: 'frozen' },
        color: '',
        muted: false,
        soloed: false,
        height: 80,
        volume: 1,
        pan: 0,
        automationMode: 'read',
    } as unknown as Track;
}

function makeUnfrozenTrack(id: string): Track {
    return {
        ...makeFrozenTrack(id),
        freezeState: { status: 'unfrozen' },
    } as unknown as Track;
}

describe('commitAdjustmentLayerMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.layerValue.value = { layers: [] };
        mocks.trackValue.value = { tracks: [], selectedTrackId: null, ghostClips: [] };
    });

    function makeInverse(): { payload: InversePayload } {
        return { payload: { expectedLayersFingerprint: '', freezeTransitions: [] } };
    }

    it('records the post-mutation layers fingerprint on the inverse action', () => {
        const inverse = makeInverse();
        mocks.layerValue.value = { layers: [] };

        commitAdjustmentLayerMutation({
            inverseAction: inverse as never,
            mutation: () => {
                // simulate the mutation writing a new layer set
                mocks.layerValue.value = { layers: [] };
            },
        });

        // afterLayers derived from the (mocked) store value at commit time
        expect(inverse.payload.expectedLayersFingerprint).toBe('[]');
    });

    it('throws when the mutation returns a value (must be synchronous)', () => {
        expect(() =>
            commitAdjustmentLayerMutation({
                inverseAction: makeInverse() as never,
                mutation: () => 'not-allowed' as unknown as void,
            })
        ).toThrow('synchronous');
    });

    it('skips freeze re-signature when there is no track state', () => {
        mocks.trackValue.value = null;
        const inverse = makeInverse();

        expect(() =>
            commitAdjustmentLayerMutation({
                inverseAction: inverse as never,
                mutation: () => undefined,
            })
        ).not.toThrow();
        expect(inverse.payload.freezeTransitions).toEqual([]);
    });

    it('leaves non-frozen tracks untouched', () => {
        const track = makeUnfrozenTrack('t1');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        const inverse = makeInverse();

        commitAdjustmentLayerMutation({
            inverseAction: inverse as never,
            mutation: () => undefined,
        });

        expect(inverse.payload.freezeTransitions).toEqual([]);
        // trackStore.set not called because nothing changed
        expect(mocks.trackSet).not.toHaveBeenCalled();
    });

    it('marks a frozen track stale and records its transition when its effective layer signature changes', () => {
        const track = makeFrozenTrack('t1');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        // before: one enabled layer affecting the track; after: layer removed → signature changes
        mocks.layerValue.value = {
            layers: [
                {
                    id: 'L',
                    name: 'EQ',
                    effectType: 'eq',
                    parameters: [{ name: 'Gain', value: 6, min: -12, max: 12, unit: 'dB' }],
                    affectedTrackIds: ['t1'],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#fff',
                },
            ],
        };
        const inverse = makeInverse();

        commitAdjustmentLayerMutation({
            inverseAction: inverse as never,
            mutation: () => {
                // mutation drops the layer
                mocks.layerValue.value = { layers: [] };
            },
        });

        const setCall = mocks.trackSet.mock.calls[0];
        const newState = setCall?.[0] as TrackStoreState | undefined;
        expect(newState?.tracks[0]?.freezeState.status).toBe('stale');
        expect(inverse.payload.freezeTransitions).toEqual([
            {
                trackId: 't1',
                previousStatus: 'frozen',
                expectedSourceSignature: expect.stringContaining('t1-clip'),
            },
        ]);
    });

    it('keeps a frozen track frozen when its effective layer signature is unchanged', () => {
        const track = makeFrozenTrack('t1');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        // before and after both empty → signatures equal
        mocks.layerValue.value = { layers: [] };
        const inverse = makeInverse();

        commitAdjustmentLayerMutation({
            inverseAction: inverse as never,
            mutation: () => undefined,
        });

        expect(inverse.payload.freezeTransitions).toEqual([]);
        expect(mocks.trackSet).not.toHaveBeenCalled();
    });

    it('restores both stores and rethrows when the mutation throws', () => {
        const beforeLayer = mocks.layerValue.value;
        const beforeTrack = mocks.trackValue.value;
        const boom = new Error('boom');

        expect(() =>
            commitAdjustmentLayerMutation({
                inverseAction: makeInverse() as never,
                mutation: () => {
                    throw boom;
                },
            })
        ).toThrow('boom');

        expect(mocks.layerSet).toHaveBeenCalledWith(beforeLayer);
        expect(mocks.trackSet).toHaveBeenCalledWith(beforeTrack);
    });
});
