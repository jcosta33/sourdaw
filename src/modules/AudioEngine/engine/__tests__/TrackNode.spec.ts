import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { createAudioEngine } from '../../repositories/createWebAudioEngine';
import { createNativePluginBridgeNode } from '../NativePluginBridgeNode';
import { TrackNode, type TrackNodeDeps } from '../TrackNode';

// The external-plugin path loads its native bridge asynchronously. Mock the
// bridge factory so the spec can capture the param ids/values that actually
// reach the native engine and control when the load resolves.
const bridgeSetParam = vi.fn<(paramId: number, value: number) => Promise<void>>();
let resolveBridge: ((result: unknown) => void) | undefined;
vi.mock('../NativePluginBridgeNode', () => ({
    createNativePluginBridgeNode: vi.fn(
        () =>
            new Promise((resolve) => {
                resolveBridge = resolve;
            })
    ),
}));

describe('TrackNode', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let deps: TrackNodeDeps;

    beforeEach(() => {
        ctx = createMockAudioContext();

        (global as any).AudioWorkletNode = class {
            port = { postMessage: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        };
        (global as any).SharedArrayBuffer = class extends ArrayBuffer {};

        deps = {
            context: ctx as any,
            masterGainNode: ctx.createGain() as any,
            getBusGainNode: vi.fn(),
            getTrackGainNode: vi.fn(),
            getSendsForTrack: vi.fn().mockReturnValue([]),
            pendingDevicePromises: new Set(),
        };
        vi.clearAllMocks();
        bridgeSetParam.mockResolvedValue();
        resolveBridge = undefined;
    });

    it('should create and wire up nodes correctly on initialization', () => {
        const track = new TrackNode('track-1', deps);

        expect(track.trackId).toBe('track-1');
        expect(track.strip.muted).toBe(false);

        // Initial wiring check (simplified)
        // gainNode -> preFaderTap -> faderNode -> postFaderGain -> panNode -> meterNode -> analyserNode -> masterGain
        expect(track.strip.gainNode.connect).toHaveBeenCalledWith(track.strip.preFaderTap);
        expect(track.strip.preFaderTap.connect).toHaveBeenCalledWith(track.strip.faderNode);
        expect(track.strip.faderNode.connect).toHaveBeenCalledWith(track.strip.postFaderGain);
        expect(track.strip.postFaderGain.connect).toHaveBeenCalledWith(track.strip.panNode);
        const meterNode = track.strip.meterNode;
        if (!meterNode) {
            throw new Error('expected the track meter node to be created');
        }
        expect(track.strip.panNode.connect).toHaveBeenCalledWith(meterNode);
        expect(meterNode.connect).toHaveBeenCalledWith(track.strip.analyserNode);
        expect(track.strip.analyserNode.connect).toHaveBeenCalledWith(deps.masterGainNode);
    });

    it('should set gain with clamping', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;

        track.setGain(0.5);
        expect(faderGain.setTargetAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime, 0.01);

        track.setGain(1.5); // should clamp to 1.0
        expect(faderGain.setTargetAtTime).toHaveBeenCalledWith(1.0, ctx.currentTime, 0.01);
    });

    it('should set pan with scale (-50..50 -> -1..1)', () => {
        const track = new TrackNode('track-1', deps);
        const panParam = track.strip.panNode.pan;

        track.setPan(50); // Hard right (1.0)
        expect(panParam.setTargetAtTime).toHaveBeenCalledWith(1.0, ctx.currentTime, 0.01);

        track.setPan(-25); // Mid left (-0.5)
        expect(panParam.setTargetAtTime).toHaveBeenCalledWith(-0.5, ctx.currentTime, 0.01);
    });

    it('should set mute state', () => {
        const track = new TrackNode('track-1', deps);
        const postFaderGain = track.strip.postFaderGain.gain;

        track.setMute(true);
        expect(track.strip.muted).toBe(true);
        expect(postFaderGain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.005);

        track.setMute(false);
        expect(track.strip.muted).toBe(false);
        expect(postFaderGain.setTargetAtTime).toHaveBeenCalledWith(1, ctx.currentTime, 0.005);
    });

    it('should route output to a bus if provided', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as any);

        const track = new TrackNode('track-1', deps);
        track.setOutput('bus-1');

        expect(deps.getBusGainNode).toHaveBeenCalledWith('bus-1');
        expect(track.strip.analyserNode.connect).toHaveBeenCalledWith(busGain);
    });

    it('adds a built-in device through the use-case resolver and wires it into the track chain', () => {
        const track = new TrackNode('track-1', deps);
        vi.mocked(ctx.createGain).mockClear();

        track.addDevice('gain-1', 'builtin-gain');

        const device = track.strip.deviceNodes.find((candidate) => candidate.deviceId === 'gain-1');
        expect(device).toBeDefined();
        if (!device) {
            throw new Error('expected builtin-gain device to be added');
        }

        expect(device.type).toBe('builtin-gain');
        expect(device.inputNode).toBe(device.outputNode);
        expect(ctx.createGain).toHaveBeenCalledTimes(1);
        expect(track.strip.gainNode.connect).toHaveBeenCalledWith(device.inputNode);
        expect(device.outputNode.connect).toHaveBeenCalledWith(track.strip.preFaderTap);
    });

    // ── Fix 8: the per-track meter SAB is one Float32 and the init message must
    // NOT claim `channels: 2` — that implied per-channel peaks the 1-float buffer
    // cannot hold. The meter is a single combined-peak readout. ──
    it('initializes the meter worklet without a misleading channels field', () => {
        const track = new TrackNode('track-1', deps);
        const meterPort = (track.strip.meterNode as any).port;

        const initCall = meterPort.postMessage.mock.calls.find(
            (c: unknown[]) => (c[0] as { type?: string })?.type === 'init'
        );
        expect(initCall).toBeDefined();
        const initMsg = initCall![0] as Record<string, unknown>;
        expect(initMsg.sab).toBeInstanceOf(ArrayBuffer);
        // The meter SAB is exactly one Float32 (4 bytes) — a single peak slot.
        expect((initMsg.sab as ArrayBuffer).byteLength).toBe(4);
        // No `channels` knob: the processor scans all input channels into the slot.
        expect('channels' in initMsg).toBe(false);
    });

    // ── Fix 2: Knead has no tuning-table consumer (its WASM exposes only
    // set_shift_semitones), so registerTuningTable must NOT post 'tuning-table'
    // to a Knead device — but must still forward it to a tuned instrument
    // (Fermenter). ──
    describe('registerTuningTable', () => {
        function makeControls() {
            return { setParam: vi.fn() };
        }

        it('does not forward a tuning table to a Knead device', () => {
            const track = new TrackNode('track-1', deps);
            const kneadControls = makeControls();
            track.strip.deviceNodes.push({
                deviceId: 'knead-1',
                type: 'knead',
                kneadControls,
            } as never);

            track.registerTuningTable([440, 466, 494]);

            expect(kneadControls.setParam).not.toHaveBeenCalled();
        });

        it('forwards the tuning table to a Fermenter device', () => {
            const track = new TrackNode('track-1', deps);
            const fermenterControls = makeControls();
            track.strip.deviceNodes.push({
                deviceId: 'ferm-1',
                type: 'fermenter',
                fermenterControls,
            } as never);

            const table = [440, 466, 494];
            track.registerTuningTable(table);

            expect(fermenterControls.setParam).toHaveBeenCalledWith('tuning-table', table);
        });
    });

    // ── Fix 3: bypassing a WASM instrument must stop held notes. Its setBypass
    // only flips a JS flag that gates new noteOn, so updateBypass must also
    // release held voices (allNotesOff) and remove the generator from the signal
    // chain (dn.bypassed + rebuild), so even an already-held voice goes silent. ──
    describe('updateBypass for a generator instrument', () => {
        function pushGenerator(track: TrackNode) {
            // A generator has no inputs (numberOfInputs === 0); rebuildChain wires
            // its output into preFaderTap when live and skips it when bypassed.
            const outputNode = { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 0 };
            const controller = { setBypass: vi.fn(), allNotesOff: vi.fn() };
            const dn = {
                deviceId: 'gen-1',
                type: 'levain',
                nodes: [outputNode],
                inputNode: outputNode,
                outputNode,
                controller,
                bypassed: false,
            };
            track.strip.deviceNodes.push(dn as never);
            track.rebuildChain();
            return { outputNode, controller, dn };
        }

        it('releases held voices and removes the generator from the chain on bypass', async () => {
            const track = new TrackNode('track-1', deps);
            const { outputNode, controller, dn } = pushGenerator(track);

            // Live: the generator output feeds the preFaderTap.
            expect(outputNode.connect).toHaveBeenCalledWith(track.strip.preFaderTap);
            outputNode.connect.mockClear();

            track.updateBypass('gen-1', true);

            // Held notes are released so a sustained voice stops at its source.
            expect(controller.allNotesOff).toHaveBeenCalledTimes(1);
            // The node's own bypass flag is set (gates new noteOn).
            expect(controller.setBypass).toHaveBeenCalledWith(true);
            // The device is flagged bypassed.
            expect(dn.bypassed).toBe(true);

            // The rebuild is coalesced onto a microtask; let it run.
            await Promise.resolve();

            // Chain rebuilt without the generator: its output is no longer wired
            // into the preFaderTap.
            expect(outputNode.connect).not.toHaveBeenCalledWith(track.strip.preFaderTap);
        });

        it('re-adds the generator to the chain on un-bypass', async () => {
            const track = new TrackNode('track-1', deps);
            const { outputNode, dn } = pushGenerator(track);

            track.updateBypass('gen-1', true);
            expect(dn.bypassed).toBe(true);
            await Promise.resolve();
            outputNode.connect.mockClear();

            track.updateBypass('gen-1', false);
            expect(dn.bypassed).toBe(false);
            await Promise.resolve();
            // Back in the signal path.
            expect(outputNode.connect).toHaveBeenCalledWith(track.strip.preFaderTap);
        });
    });

    // Regression: live reload (ensureTrackStrips) adds the external-plugin device
    // then immediately replays saved Track.devices[*].parameterValues via
    // updateParam — but the bridge loads asynchronously, so those values land on
    // the loading placeholder. They must be flushed to the native bridge once it
    // resolves, the way the offline NativeDspDeviceStrategy replays them. Before
    // the fix the buffered params were dropped, leaving the live engine at
    // defaults while offline render reflected saved knobs.
    it('replays params buffered before the native plugin bridge loads', async () => {
        const track = new TrackNode('track-1', deps);

        // Live reload order: addDevice, then updateParam from saved values —
        // while the async bridge load is still pending.
        track.addDevice('dev-1', 'external-plugin', 'inst-1', 'plugin-1');
        track.updateParam('dev-1', '3', 0.75);
        track.updateParam('dev-1', '7', -2);

        expect(resolveBridge).toBeDefined();
        expect(createNativePluginBridgeNode).toHaveBeenCalledWith(
            expect.objectContaining({
                context: ctx,
                instanceId: 'inst-1',
                pluginId: 'plugin-1',
                signal: expect.any(AbortSignal),
            })
        );
        // Nothing should have reached the native bridge yet — it isn't loaded.
        expect(bridgeSetParam).not.toHaveBeenCalled();

        // Resolve the bridge load and let the .then swap-in run.
        const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
        const destroy = vi.fn(() => {
            bridgeNode.disconnect();
            bridgeNode.port.close();
            return Promise.resolve();
        });
        resolveBridge!({
            workletNode: bridgeNode,
            setParam: bridgeSetParam,
            setBypass: vi.fn(),
            destroy,
        });
        await Promise.all([...deps.pendingDevicePromises]);

        // The buffered params reach the native bridge with the external-plugin
        // name->id translation (parseInt) applied.
        expect(bridgeSetParam).toHaveBeenCalledWith(3, 0.75);
        expect(bridgeSetParam).toHaveBeenCalledWith(7, -2);
        expect(bridgeSetParam).toHaveBeenCalledTimes(2);
        track.removeDevice('dev-1');
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(bridgeNode.disconnect).toHaveBeenCalled();
        expect(bridgeNode.port.close).toHaveBeenCalledTimes(1);
    });

    it('keeps waitForDevices pending until the external lifecycle generation is ready', async () => {
        const engine = createAudioEngine(ctx as unknown as AudioContext);
        engine.addDeviceToStrip('track-1', 'dev-1', 'external-plugin', 'inst-1', 'plugin-1');
        let waitSettled = false;
        const waiting = engine.waitForDevices().then(() => {
            waitSettled = true;
            return undefined;
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(waitSettled).toBe(false);

        const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
        expect(resolveBridge).toBeDefined();
        resolveBridge!({
            workletNode: bridgeNode,
            setParam: bridgeSetParam,
            setBypass: vi.fn(),
            destroy: vi.fn().mockResolvedValue(undefined),
        });

        await waiting;
        expect(waitSettled).toBe(true);
    });
});
