import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type AdjustmentLayer } from '#/modules/Arrangement/stores';

import { adjustmentApplicationStore } from '../../../stores/adjustmentApplicationStore';
import { getSharedAdjustmentLayerApplier } from '../sharedAdjustmentLayerApplier';

import { resetSharedAdjustmentLayerApplierForTest } from './resetSharedAdjustmentLayerApplierForTest';

const mocks = vi.hoisted(() => ({
    engine: {
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        applyAdjustmentLayerTick: vi.fn(),
        resetAdjustmentLayers: vi.fn(),
    },
    trackState: null as { tracks: Array<{ id: string; gain: number; pan: number }> } | null,
    subscribers: [] as Array<() => void>,
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: mocks.engine,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return mocks.trackState;
            },
            subscribe: (callback: () => void) => {
                mocks.subscribers.push(callback);
                return () => {
                    mocks.subscribers = mocks.subscribers.filter((subscriber) => subscriber !== callback);
                };
            },
        },
    };
});

function fireTrackStoreSubscribers(): void {
    for (const subscriber of [...mocks.subscribers]) {
        subscriber();
    }
}

function makeLayer(overrides?: Partial<AdjustmentLayer>): AdjustmentLayer {
    return {
        id: 'layer-1',
        name: 'Layer 1',
        effectType: 'volume',
        parameters: [{ name: 'Gain', value: 6, min: -24, max: 24, unit: 'dB' }],
        affectedTrackIds: ['t1'],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix: 1,
        color: 'oklch(0.4 0.1 180)',
        ...overrides,
    };
}

function setTracks(tracks: Array<{ id: string; gain: number; pan: number }>): void {
    mocks.trackState = { tracks };
}

const GAIN_6DB = 10 ** (6 / 20);

describe('getSharedAdjustmentLayerApplier', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.subscribers = [];
        setTracks([{ id: 't1', gain: 0.8, pan: 0 }]);
        resetSharedAdjustmentLayerApplierForTest();
    });

    afterEach(() => {
        resetSharedAdjustmentLayerApplierForTest();
    });

    it('applies a volume layer as fader-times-layer gain through the engine', () => {
        const applier = getSharedAdjustmentLayerApplier();

        const records = applier.applyLayers({ activeLayers: [makeLayer()], beat: 0 });

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            layerId: 'layer-1',
            trackId: 't1',
            effectType: 'volume',
            blend: 1,
            parameters: { Gain: 6 },
        });
        expect(mocks.engine.setTrackGain).toHaveBeenCalledTimes(1);
        const [trackId, gain] = mocks.engine.setTrackGain.mock.calls[0]!;
        expect(trackId).toBe('t1');
        expect(gain).toBeCloseTo(0.8 * GAIN_6DB, 6);
        // Volume layers are strip-side only — they never reach the DSP tick.
        expect(mocks.engine.applyAdjustmentLayerTick).toHaveBeenCalledWith([]);
    });

    it('publishes every applied record to the adjustment application store per batch', () => {
        const applier = getSharedAdjustmentLayerApplier();

        applier.applyLayers({ activeLayers: [makeLayer()], beat: 2 });

        expect(adjustmentApplicationStore.value?.applied).toHaveLength(1);
        expect(adjustmentApplicationStore.value?.applied[0]).toMatchObject({
            layerId: 'layer-1',
            trackId: 't1',
            beat: 2,
        });

        // The next batch replaces (not appends to) the applied log.
        applier.applyLayers({ activeLayers: [], beat: 3 });
        expect(adjustmentApplicationStore.value?.applied).toEqual([]);
    });

    it('applies a pan layer additively on the pan axis, clamped to the strip range', () => {
        setTracks([{ id: 't1', gain: 0.8, pan: 30 }]);
        const applier = getSharedAdjustmentLayerApplier();
        const panLayer = makeLayer({
            id: 'layer-pan',
            effectType: 'pan',
            parameters: [{ name: 'Pan', value: 100, min: -100, max: 100, unit: '%' }],
        });

        applier.applyLayers({ activeLayers: [panLayer], beat: 0 });

        // user pan 30 + (100% blend → +50) = 80 → clamped to the ±50 strip range.
        expect(mocks.engine.setTrackPan).toHaveBeenCalledWith('t1', 50);
    });

    it('restores the remembered user fader when the layer deactivates', () => {
        const applier = getSharedAdjustmentLayerApplier();
        applier.applyLayers({ activeLayers: [makeLayer()], beat: 0 });
        mocks.engine.setTrackGain.mockClear();

        applier.applyLayers({ activeLayers: [makeLayer({ enabled: false })], beat: 1 });

        expect(mocks.engine.setTrackGain).toHaveBeenCalledWith('t1', 0.8);
    });

    it('multiplies stacked volume layers over the same track', () => {
        const applier = getSharedAdjustmentLayerApplier();
        const first = makeLayer({ id: 'layer-a' });
        const second = makeLayer({ id: 'layer-b' });

        applier.applyLayers({ activeLayers: [first, second], beat: 0 });

        const lastCall = mocks.engine.setTrackGain.mock.calls.at(-1)!;
        expect(lastCall[0]).toBe('t1');
        expect(lastCall[1]).toBeCloseTo(0.8 * GAIN_6DB * GAIN_6DB, 6);
    });

    it('targets every track from the insertion index when no explicit tracks are set', () => {
        setTracks([
            { id: 't1', gain: 1, pan: 0 },
            { id: 't2', gain: 1, pan: 0 },
            { id: 't3', gain: 1, pan: 0 },
        ]);
        const applier = getSharedAdjustmentLayerApplier();
        const layer = makeLayer({ affectedTrackIds: [], insertionIndex: 1 });

        const records = applier.applyLayers({ activeLayers: [layer], beat: 0 });

        expect(records.map((record) => record.trackId)).toEqual(['t2', 't3']);
        expect(mocks.engine.setTrackGain).not.toHaveBeenCalledWith('t1', expect.anything());
    });

    it('forwards non-volume/pan effect records to the engine adjustment tick', () => {
        const applier = getSharedAdjustmentLayerApplier();
        const eqLayer = makeLayer({
            id: 'layer-eq',
            effectType: 'eq',
            parameters: [{ name: 'High Gain', value: 4, min: -12, max: 12, unit: 'dB' }],
        });

        applier.applyLayers({ activeLayers: [eqLayer, makeLayer()], beat: 5 });

        expect(mocks.engine.applyAdjustmentLayerTick).toHaveBeenCalledWith([
            {
                trackId: 't1',
                layerId: 'layer-eq',
                effectType: 'eq',
                parameters: { 'High Gain': 4 },
                blend: 1,
            },
        ]);
    });

    it('recomposes from the new fader base when the user moves the fader mid-layer', () => {
        const applier = getSharedAdjustmentLayerApplier();
        applier.applyLayers({ activeLayers: [makeLayer()], beat: 0 });
        mocks.engine.setTrackGain.mockClear();

        // The user drags the fader to 0.5 — observed through the track store.
        setTracks([{ id: 't1', gain: 0.5, pan: 0 }]);
        fireTrackStoreSubscribers();

        expect(mocks.engine.setTrackGain).toHaveBeenCalledTimes(1);
        const [, gain] = mocks.engine.setTrackGain.mock.calls[0]!;
        expect(gain).toBeCloseTo(0.5 * GAIN_6DB, 6);
    });

    it('reset restores strip state, clears the application log, and resets engine layers', () => {
        const applier = getSharedAdjustmentLayerApplier();
        applier.applyLayers({ activeLayers: [makeLayer()], beat: 0 });
        mocks.engine.setTrackGain.mockClear();

        applier.reset();

        expect(mocks.engine.setTrackGain).toHaveBeenCalledWith('t1', 0.8);
        expect(adjustmentApplicationStore.value?.applied).toEqual([]);
        expect(mocks.engine.resetAdjustmentLayers).toHaveBeenCalledTimes(1);
    });
});
