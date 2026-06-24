import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { TrackNode, type TrackNodeDeps } from '../TrackNode';

// The external-plugin path loads its native bridge asynchronously. Mock the
// bridge factory so the spec can capture the param ids/values that actually
// reach the native engine and control when the load resolves.
const bridgeSetParam = vi.fn<(paramId: number, value: number) => void>();
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
        ctx = createMockAudioContext() as any;

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
        expect(track.strip.panNode.connect).toHaveBeenCalledWith(track.strip.meterNode);
        expect(track.strip.meterNode.connect).toHaveBeenCalledWith(track.strip.analyserNode);
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
        track.addDevice('dev-1', 'external-plugin', 'inst-1');
        track.updateParam('dev-1', '3', 0.75);
        track.updateParam('dev-1', '7', -2);

        expect(resolveBridge).toBeDefined();
        // Nothing should have reached the native bridge yet — it isn't loaded.
        expect(bridgeSetParam).not.toHaveBeenCalled();

        // Resolve the bridge load and let the .then swap-in run.
        resolveBridge!({
            workletNode: { disconnect: vi.fn(), connect: vi.fn() },
            setParam: bridgeSetParam,
            setBypass: vi.fn(),
            destroy: vi.fn(),
        });
        await Promise.all([...deps.pendingDevicePromises]);

        // The buffered params reach the native bridge with the external-plugin
        // name->id translation (parseInt) applied.
        expect(bridgeSetParam).toHaveBeenCalledWith(3, 0.75);
        expect(bridgeSetParam).toHaveBeenCalledWith(7, -2);
        expect(bridgeSetParam).toHaveBeenCalledTimes(2);
    });
});
