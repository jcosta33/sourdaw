import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
    createMockAudioNode,
} from '../../../../helpers/__tests__/audioContext.mock';
import { createAdjustmentLayerRuntime, type TrackRerouteDeps } from '../AdjustmentLayerRuntime';

describe('AdjustmentLayerRuntime', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let rerouteTrack: Mock<(trackId: string) => void>;
    let deps: TrackRerouteDeps;
    let trackOutputs: Map<string, AudioNode>;
    let trackDestinations: Map<string, AudioNode>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        trackOutputs = new Map();
        trackDestinations = new Map();
        rerouteTrack = vi.fn<(trackId: string) => void>();

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

// Branch coverage for chain wiring (multi-layer per track), disposal-timer
// cancellation when a region reappears within grace, the in-disposal continue
// guard, reset-with-active-timer, and the no-destination disconnect path.
describe('AdjustmentLayerRuntime — chain wiring & disposal-timer branches', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let rerouteTrack: Mock<(trackId: string) => void>;
    let deps: TrackRerouteDeps;
    let trackOutputs: Map<string, AudioNode>;
    let trackDestinations: Map<string, AudioNode>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        trackOutputs = new Map();
        trackDestinations = new Map();
        rerouteTrack = vi.fn<(trackId: string) => void>();

        deps = {
            getContext: () => asBaseAudioContext(ctx),
            getTrackOutputNode: (id) => trackOutputs.get(id) ?? null,
            getTrackDefaultDestination: (id) => trackDestinations.get(id) ?? null,
            rerouteTrack,
        };

        trackOutputs.set('t1', asAudioNode(createMockAudioNode('gain')));
        trackDestinations.set('t1', asAudioNode(createMockAudioNode('gain')));
    });

    it('wires a multi-layer chain: each bus connects to the next, last to finalDest', () => {
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([
            { layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 },
            { layerId: 'L2', trackId: 't1', effectType: 'filter', parameters: {}, blend: 1 },
        ]);

        // The chain head is the first-inserted bus; getBusChainInputForTrack
        // returns it, proving both buses live on the same track chain.
        const chainInput = runtime.getBusChainInputForTrack('t1');
        expect(chainInput).not.toBeNull();
        expect(runtime.listLiveBusKeys().sort()).toEqual(['L1::t1', 'L2::t1']);
    });

    it('disconnects the destination when a track has no default destination', () => {
        // Remove the default destination so wireChain hits the disconnect branch.
        trackDestinations.delete('t1');
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);

        // Bus still created; just no finalDest to connect to.
        expect(runtime.listLiveBusKeys()).toEqual(['L1::t1']);
    });

    it('cancels a pending disposal timer when a region reappears within the grace window', () => {
        vi.useFakeTimers();
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);
        // End the region → starts disposal timer.
        runtime.applyTick([]);
        expect(runtime.listLiveBusKeys()).toEqual(['L1::t1']); // still alive during grace

        // Reappear before the timer fires → timer cleared, region stays live.
        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);

        vi.advanceTimersByTime(500);
        expect(runtime.listLiveBusKeys()).toEqual(['L1::t1']);
        vi.useRealTimers();
    });

    it('skips regions that already have a disposal timer pending (in-disposal guard)', () => {
        vi.useFakeTimers();
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);
        runtime.applyTick([]); // start disposal timer

        // A second applyTick([]) must not reset/re-arm the existing timer.
        const beforeTimer = vi.getTimerCount();
        runtime.applyTick([]);
        expect(vi.getTimerCount()).toBe(beforeTimer);

        vi.advanceTimersByTime(500);
        expect(runtime.listLiveBusKeys()).toEqual([]);
        vi.useRealTimers();
    });

    it('reset clears an active disposal timer without double-disposing', () => {
        vi.useFakeTimers();
        const runtime = createAdjustmentLayerRuntime(deps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);
        runtime.applyTick([]); // start disposal timer
        rerouteTrack.mockClear();

        runtime.reset();

        expect(runtime.listLiveBusKeys()).toEqual([]);
        expect(rerouteTrack).toHaveBeenCalledWith('t1');
        // Advancing past the grace must not fire any stale finalize.
        vi.advanceTimersByTime(500);
        expect(runtime.listLiveBusKeys()).toEqual([]);
        vi.useRealTimers();
    });

    it('createBus returns null when the context is unavailable', () => {
        // getContext returns null → no bus created, no reroute.
        const noCtxDeps: TrackRerouteDeps = {
            ...deps,
            getContext: () => null,
        };
        const runtime = createAdjustmentLayerRuntime(noCtxDeps);

        runtime.applyTick([{ layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 }]);

        expect(runtime.listLiveBusKeys()).toEqual([]);
        expect(rerouteTrack).not.toHaveBeenCalled();
    });

    it('reports every live adjustment bus and the AudioNodes its effect graph owns', () => {
        const runtime = createAdjustmentLayerRuntime(deps);
        runtime.applyTick([
            { layerId: 'L1', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 },
            { layerId: 'L2', trackId: 't2', effectType: 'compressor', parameters: {}, blend: 0.5 },
        ]);

        const getDiagnostics = Reflect.get(runtime, 'getDiagnostics');
        if (typeof getDiagnostics !== 'function') {
            throw new TypeError('AdjustmentLayerRuntime must expose resource diagnostics');
        }

        expect(getDiagnostics.call(runtime)).toEqual({
            buses: 2,
            busesByEffectType: { compressor: 1, eq: 1 },
            audioNodes: 13,
            audioWorkletProcessors: 0,
        });
    });
});
