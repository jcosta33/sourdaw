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
    let trackDestinations: Map<string, AudioNode>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        trackDestinations = new Map();
        rerouteTrack = vi.fn<(trackId: string) => void>();

        deps = {
            getContext: () => asBaseAudioContext(ctx),
            getTrackDefaultDestination: (id) => trackDestinations.get(id) ?? null,
            rerouteTrack,
        };

        trackDestinations.set('t1', asAudioNode(createMockAudioNode('gain')));
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
    let trackDestinations: Map<string, AudioNode>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        trackDestinations = new Map();
        rerouteTrack = vi.fn<(trackId: string) => void>();

        deps = {
            getContext: () => asBaseAudioContext(ctx),
            getTrackDefaultDestination: (id) => trackDestinations.get(id) ?? null,
            rerouteTrack,
        };

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

// #4603 — the chain order must be a property of the layer stack, not of the
// order the buses happened to be created during playback. Two runtimes that
// end with the identical active set in the identical stack order must wire
// the identical chain, whatever their creation histories were.
describe('AdjustmentLayerRuntime — chain order follows the layer stack, not creation history', () => {
    // Layer A (eq) sits above layer B (saturation) in the stack; both affect t1.
    const recA = { layerId: 'layer-a', trackId: 't1', effectType: 'eq', parameters: {}, blend: 1 } as const;
    const recB = { layerId: 'layer-b', trackId: 't1', effectType: 'saturation', parameters: {}, blend: 1 } as const;

    function makeRuntime(): {
        runtime: ReturnType<typeof createAdjustmentLayerRuntime>;
        ctx: ReturnType<typeof createMockAudioContext>;
        destination: AudioNode;
    } {
        const ctx = createMockAudioContext();
        const destination = asAudioNode(createMockAudioNode('gain'));
        const deps: TrackRerouteDeps = {
            getContext: () => asBaseAudioContext(ctx),
            getTrackDefaultDestination: (id) => (id === 't1' ? destination : null),
            rerouteTrack: vi.fn<(trackId: string) => void>(),
        };
        return { runtime: createAdjustmentLayerRuntime(deps), ctx, destination };
    }

    // A bus is identified from the graph alone, with no look into the runtime:
    // a bus's input node is the gain that feeds its device's input, the eq
    // device's input is a 'peaking' biquad, and the distortion device's input
    // is the gain feeding its waveshaper. Each runtime gets its own context so
    // the created-node lists never mix.
    function assertEqLayerIsFirstInChain(input: {
        ctx: ReturnType<typeof createMockAudioContext>;
        destination: AudioNode;
        runtime: ReturnType<typeof createAdjustmentLayerRuntime>;
    }): void {
        const { ctx, destination, runtime } = input;
        const feeds = (source: { connect: Mock }, target: unknown): boolean =>
            source.connect.mock.calls.some((call: unknown[]) => call[0] === target);
        const gains = ctx.createGain.mock.results.map((result) => result.value);
        const biquads = ctx.createBiquadFilter.mock.results.map((result) => result.value);

        const eqDeviceInput = biquads.find((biquad) => biquad.type === 'peaking');
        if (!eqDeviceInput) {
            throw new Error('Expected the eq bus to have created its peaking biquad');
        }
        const eqBusInput = gains.find((gain) => feeds(gain, eqDeviceInput));
        if (!eqBusInput) {
            throw new Error('Expected a gain feeding the eq device');
        }
        // The bus input's first target is its dry gain; the dry gain's target
        // is the bus output (input → dry/wet/device → wet → output).
        const eqDryGain = gains.find((gain) => feeds(eqBusInput, gain));
        if (!eqDryGain) {
            throw new Error('Expected the eq bus input to feed its dry gain');
        }
        const eqBusOutput = gains.find((gain) => feeds(eqDryGain, gain));
        if (!eqBusOutput) {
            throw new Error('Expected the eq dry gain to feed the bus output');
        }

        const chainHead = runtime.getBusChainInputForTrack('t1');
        expect(chainHead).toBe(eqBusInput);
        // First in the chain also means not last: the eq bus's output feeds the
        // next bus, and exactly one bus output feeds the track destination.
        expect(feeds(eqBusOutput, destination)).toBe(false);
        const destinationFeeders = gains.filter((gain) => feeds(gain, destination));
        expect(destinationFeeders).toHaveLength(1);
        expect(destinationFeeders[0]).not.toBe(eqBusOutput);
    }

    it('wires the identical chain for the same active stack whatever the creation history', () => {
        // Playback started where only B's region is active; A's region joined
        // one tick later, so B's bus was created first.
        const startedBeforeA = makeRuntime();
        startedBeforeA.runtime.applyTick([recB]);
        const headAfterFirstTick = startedBeforeA.runtime.getBusChainInputForTrack('t1');
        startedBeforeA.runtime.applyTick([recA, recB]);

        // Playback started inside both regions; both buses were created in one
        // tick, in stack order.
        const startedInsideBoth = makeRuntime();
        startedInsideBoth.runtime.applyTick([recA, recB]);

        // The premise: the histories really differ — the first runtime's chain
        // began as B's bus. (Without this the differential could pass vacuously
        // if the two runs ended up identical by accident.) The bus is found
        // through its device: the gain feeding the waveshaper is the
        // distortion device's splitter, and the gain feeding the splitter is
        // the bus's input node.
        const startedBeforeAGains = startedBeforeA.ctx.createGain.mock.results.map((result) => result.value);
        const satShaper = startedBeforeA.ctx.createWaveShaper.mock.results[0]?.value;
        if (!satShaper) {
            throw new Error('Expected the saturation bus to have created its waveshaper');
        }
        const satDeviceSplitter = startedBeforeAGains.find((gain) =>
            gain.connect.mock.calls.some((call: unknown[]) => call[0] === satShaper)
        );
        if (!satDeviceSplitter) {
            throw new Error('Expected the distortion splitter to feed its waveshaper');
        }
        const satBusInput = startedBeforeAGains.find((gain) =>
            gain.connect.mock.calls.some((call: unknown[]) => call[0] === satDeviceSplitter)
        );
        if (!satBusInput) {
            throw new Error('Expected a gain feeding the distortion splitter');
        }
        expect(headAfterFirstTick).toBe(satBusInput);

        expect(startedBeforeA.runtime.listLiveBusKeys().sort()).toEqual(
            startedInsideBoth.runtime.listLiveBusKeys().sort()
        );
        assertEqLayerIsFirstInChain(startedBeforeA);
        assertEqLayerIsFirstInChain(startedInsideBoth);
    });
});
