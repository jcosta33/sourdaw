import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
    createMockAudioNode,
} from '../../../../helpers/__tests__/audioContext.mock';
import { createAdjustmentLayerRuntime, type TrackRerouteDeps } from '../AdjustmentLayerRuntime';

describe('AdjustmentLayerRuntime', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let rerouteTrack: ReturnType<typeof vi.fn>;
    let deps: TrackRerouteDeps;
    let trackOutputs: Map<string, AudioNode>;
    let trackDestinations: Map<string, AudioNode>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        trackOutputs = new Map();
        trackDestinations = new Map();
        rerouteTrack = vi.fn();

        deps = {
            getContext: () => asBaseAudioContext(ctx),
            getTrackOutputNode: (id) => trackOutputs.get(id) ?? null,
            getTrackDefaultDestination: (id) => trackDestinations.get(id) ?? null,
            rerouteTrack,
        };

        trackOutputs.set('t1', asAudioNode(createMockAudioNode('gain')));
        trackDestinations.set('t1', asAudioNode(createMockAudioNode('gain')));
        trackOutputs.set('t2', asAudioNode(createMockAudioNode('gain')));
        trackDestinations.set('t2', asAudioNode(createMockAudioNode('gain')));
    });

    it('creates a bus for a new (layer, track) pair and reroutes the track', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([
            {
                layerId: 'L1',
                trackId: 't1',
                effectType: 'eq',
                parameters: { 'High Gain': 6 },
                blend: 1,
            },
        ]);

        expect(rerouteTrack).toHaveBeenCalledWith('t1');
        expect(runtime.listLiveBusKeys()).toEqual(['L1::t1']);
        expect(runtime.getBusInputForTrack('t1')).not.toBeNull();
    });

    it('disposes the bus and reroutes the track when the region ends (after fade grace)', () => {
        vi.useFakeTimers();
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);
        rerouteTrack.mockClear();

        runtime.applyTick([]);
        expect(runtime.listLiveBusKeys()).toEqual(['L1::t1']);

        vi.advanceTimersByTime(500);

        expect(runtime.listLiveBusKeys()).toEqual([]);
        expect(runtime.getBusInputForTrack('t1')).toBeNull();
        expect(rerouteTrack).toHaveBeenCalledWith('t1');
        vi.useRealTimers();
    });

    it('does not create buses for volume or pan effect types (those are MVP-handled)', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([
            { layerId: 'LV', trackId: 't1', effectType: 'volume', parameters: { Gain: -6 }, blend: 1 },
            { layerId: 'LP', trackId: 't2', effectType: 'pan', parameters: { Pan: 50 }, blend: 1 },
        ]);

        expect(runtime.listLiveBusKeys()).toEqual([]);
    });

    it('updates existing bus blend without recreating it', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 0.2 }]);
        const firstKeys = runtime.listLiveBusKeys();

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 0.8 }]);
        const secondKeys = runtime.listLiveBusKeys();

        expect(firstKeys).toEqual(secondKeys);
    });

    it('forwards parameter changes to the bus on params delta', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([
            { layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: { 'High Gain': 0 }, blend: 1 },
        ]);
        runtime.applyTick([
            { layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: { 'High Gain': 6 }, blend: 1 },
        ]);

        expect(vi.mocked(ctx.createBiquadFilter).mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('reset disposes all buses and reroutes their tracks', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([
            { layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 },
            { layerId: 'L2', trackId: 't2', effectType: 'filter', parameters: {}, blend: 1 },
        ]);
        rerouteTrack.mockClear();

        runtime.reset();

        expect(runtime.listLiveBusKeys()).toEqual([]);
        expect(rerouteTrack).toHaveBeenCalledWith('t1');
        expect(rerouteTrack).toHaveBeenCalledWith('t2');
    });
});
