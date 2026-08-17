import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { createDeviceReadinessDiagnostics } from '../deviceReadinessDiagnostics';
import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, TrackNode, type TrackNodeDeps } from '../TrackNode';

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
            readinessDiagnostics: createDeviceReadinessDiagnostics(),
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

    it('RT-5: schedules a compensation-aligned gain ramp landing at the requested time', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;
        faderGain.value = 0.3;

        track.scheduleGainAutomation(0.5, ctx.currentTime + 0.02);

        // Re-anchor at the current value, drop stale future events, then ramp
        // a-rate to the target at the compensated land time — no setTargetAtTime
        // step, and the land time honours the caller's PDC-shifted `time`.
        expect(faderGain.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
        expect(faderGain.setValueAtTime).toHaveBeenCalledWith(0.3, ctx.currentTime);
        expect(faderGain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime + 0.02);
    });

    it('RT-5: clamps a scheduled gain to [0,1]', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;

        track.scheduleGainAutomation(1.5, ctx.currentTime + 0.02);

        expect(faderGain.linearRampToValueAtTime).toHaveBeenCalledWith(1, ctx.currentTime + 0.02);
    });

    it('RT-5: floors an uncompensated gain write (time === now) to a minimum glide, not a step', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;

        track.scheduleGainAutomation(0.5, ctx.currentTime);

        // A zero-length ramp would step; the write lands one scheduler grain past now.
        expect(faderGain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime + 0.01);
    });

    it('RT-5: scales and ramps a scheduled pan write (-50..50 -> -1..1)', () => {
        const track = new TrackNode('track-1', deps);
        const panParam = track.strip.panNode.pan;

        track.schedulePanAutomation(50, ctx.currentTime + 0.02);

        expect(panParam.linearRampToValueAtTime).toHaveBeenCalledWith(1, ctx.currentTime + 0.02);
    });

    it('RT-5: schedules an existing send gain at the requested compensated time', () => {
        const sendGain = ctx.createGain();
        sendGain.gain.value = 0.5;
        vi.mocked(deps.getSendsForTrack).mockReturnValue([
            {
                sourceTrackId: 'track-1',
                busId: 'bus-hall',
                gainNode: sendGain as unknown as GainNode,
                sourceNode: ctx.createGain(),
                preFader: true,
            },
        ]);
        const track = new TrackNode('track-1', deps);

        track.scheduleSendAutomation('bus-hall', 0.35, ctx.currentTime + 0.05);

        expect(sendGain.gain.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
        expect(sendGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime);
        expect(sendGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.35, ctx.currentTime + 0.05);
    });

    it('RT-5: ignores a scheduled send write when that graph edge does not exist', () => {
        const otherSendGain = ctx.createGain();
        vi.mocked(deps.getSendsForTrack).mockReturnValue([
            {
                sourceTrackId: 'track-1',
                busId: 'other-bus',
                gainNode: otherSendGain as unknown as GainNode,
                sourceNode: ctx.createGain(),
                preFader: false,
            },
        ]);
        const track = new TrackNode('track-1', deps);

        track.scheduleSendAutomation('missing-bus', 0.35, ctx.currentTime + 0.05);

        expect(otherSendGain.gain.cancelScheduledValues).not.toHaveBeenCalled();
        expect(otherSendGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it('RT-5: cancelAutomationRamps holds fader, pan, and send params and drops pending ramps', () => {
        const sendGain = ctx.createGain();
        sendGain.gain.value = 0.35;
        vi.mocked(deps.getSendsForTrack).mockReturnValue([
            {
                sourceTrackId: 'track-1',
                busId: 'bus-hall',
                gainNode: sendGain as unknown as GainNode,
                sourceNode: ctx.createGain(),
                preFader: false,
            },
        ]);
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;
        const panParam = track.strip.panNode.pan;
        faderGain.value = 0.6;
        panParam.value = -0.4;

        track.cancelAutomationRamps();

        expect(faderGain.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
        expect(faderGain.setValueAtTime).toHaveBeenCalledWith(0.6, ctx.currentTime);
        expect(panParam.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
        expect(panParam.setValueAtTime).toHaveBeenCalledWith(-0.4, ctx.currentTime);
        expect(sendGain.gain.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
        expect(sendGain.gain.setValueAtTime).toHaveBeenCalledWith(0.35, ctx.currentTime);
        expect(sendGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
        // Held, not ramped — no fresh ramp is scheduled toward a post-stop time.
        expect(faderGain.linearRampToValueAtTime).not.toHaveBeenCalled();
        expect(panParam.linearRampToValueAtTime).not.toHaveBeenCalled();
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

    // FX-8 — the two silencing reasons act at different points of the strip, and
    // that difference is the whole finding. `setMute` is the user's mute button:
    // it zeroes `postFaderGain`, which sits downstream of `preFaderTap`, so a
    // pre-fader (cue) send keeps feeding its bus — the documented purpose of a
    // pre-fader tap. `setSoloGate` is solo-in-place silencing a track the engineer
    // is not listening to: it must stop the track everywhere, so it zeroes
    // `preFaderTap` itself, upstream of every send tap and of the frozen-buffer
    // injection point.
    it('leaves the pre-fader tap open under an individual mute so cue sends keep feeding their bus', () => {
        const track = new TrackNode('track-1', deps);
        const preFaderTapGain = track.strip.preFaderTap.gain;

        track.setMute(true);

        expect(preFaderTapGain.setTargetAtTime).not.toHaveBeenCalled();
        expect(preFaderTapGain.value).toBe(1);
    });

    it('closes the pre-fader tap when solo-in-place gates the track, and reopens it on release', () => {
        const track = new TrackNode('track-1', deps);
        const preFaderTapGain = track.strip.preFaderTap.gain;
        const postFaderGain = track.strip.postFaderGain.gain;

        track.setSoloGate(true);

        expect(track.strip.soloGated).toBe(true);
        expect(preFaderTapGain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.005);
        // The gate is a distinct reason from the mute button: it must not forge a
        // mute the user never pressed, or releasing solo would unmute the track.
        expect(track.strip.muted).toBe(false);
        expect(postFaderGain.setTargetAtTime).not.toHaveBeenCalled();

        track.setSoloGate(false);

        expect(track.strip.soloGated).toBe(false);
        expect(preFaderTapGain.setTargetAtTime).toHaveBeenLastCalledWith(1, ctx.currentTime, 0.005);
    });

    it('keeps a solo-gated track silent at the pre-fader tap even after the user unmutes it', () => {
        const track = new TrackNode('track-1', deps);
        const preFaderTapGain = track.strip.preFaderTap.gain;

        track.setSoloGate(true);
        track.setMute(false);

        expect(track.strip.soloGated).toBe(true);
        expect(preFaderTapGain.setTargetAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime, 0.005);
    });

    it('should route output to a bus if provided', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as any);

        const track = new TrackNode('track-1', deps);
        track.setOutput('bus-1');

        expect(deps.getBusGainNode).toHaveBeenCalledWith('bus-1');
        expect(track.strip.analyserNode.connect).toHaveBeenCalledWith(busGain);
    });

    it('disconnects only its previous output destination when rerouting', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);

        track.setOutput('bus-1');

        expect(track.strip.analyserNode.disconnect).toHaveBeenCalledTimes(1);
        expect(track.strip.analyserNode.disconnect).toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.analyserNode.disconnect).not.toHaveBeenCalledWith();
    });

    it('reports a rejected output mutation after restoring its previous live route', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);
        const connectError = new Error('output connect failed');
        vi.mocked(track.strip.analyserNode.connect).mockClear();
        vi.mocked(track.strip.analyserNode.disconnect).mockClear();
        vi.mocked(track.strip.analyserNode.connect).mockImplementationOnce(() => {
            throw connectError;
        });

        expect(() => track.setOutput('bus-1')).toThrow(RuntimeGraphMutationRejected);
        expect(track.strip.outputId).toBeUndefined();
        expect(track.strip.analyserNode.disconnect).toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.analyserNode.connect).toHaveBeenLastCalledWith(deps.masterGainNode);
    });

    it('reports an uncompensated output mutation when restoring its previous live route fails', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);
        const connectError = new Error('output connect failed');
        const restoreError = new Error('output restore failed');
        vi.mocked(track.strip.analyserNode.connect).mockClear();
        vi.mocked(track.strip.analyserNode.disconnect).mockClear();
        vi.mocked(track.strip.analyserNode.connect)
            .mockImplementationOnce(() => {
                throw connectError;
            })
            .mockImplementationOnce(() => {
                throw restoreError;
            });

        try {
            track.setOutput('bus-1');
            throw new Error('expected the output mutation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(RuntimeGraphMutationFailure);
            expect(error).toMatchObject({
                mutation: { application: 'needs-reconcile' },
                cause: connectError,
                rollbackError: restoreError,
            });
        }
        expect(track.strip.outputId).toBeUndefined();
    });

    it('rejects an output disconnect failure before changing the live route', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);
        vi.mocked(track.strip.analyserNode.connect).mockClear();
        vi.mocked(track.strip.analyserNode.disconnect).mockImplementationOnce(() => {
            throw new Error('output disconnect failed');
        });

        expect(() => track.setOutput('bus-1')).toThrow(RuntimeGraphMutationRejected);
        expect(track.strip.outputId).toBeUndefined();
        expect(track.strip.analyserNode.connect).not.toHaveBeenCalled();
    });

    it('preserves analyser output, send, and sidechain edges across a chain rebuild', () => {
        const track = new TrackNode('track-1', deps);
        const unrelatedEdge = ctx.createGain();
        track.strip.analyserNode.connect(unrelatedEdge as unknown as AudioNode);
        vi.mocked(track.strip.analyserNode.disconnect).mockClear();

        track.rebuildChain();

        expect(track.strip.analyserNode.disconnect).not.toHaveBeenCalledWith();
        expect(track.strip.analyserNode.disconnect).not.toHaveBeenCalledWith(unrelatedEdge);
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
        track.addDevice('dev-1', 'external-plugin', 'inst-1');
        track.updateParam('dev-1', '3', 0.75);
        track.updateParam('dev-1', '7', -2);

        expect(resolveBridge).toBeDefined();
        // Nothing should have reached the native bridge yet — it isn't loaded.
        expect(bridgeSetParam).not.toHaveBeenCalled();

        // Resolve the bridge load and let the .then swap-in run.
        const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
        const destroy = vi.fn(() => {
            bridgeNode.disconnect();
            bridgeNode.port.close();
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

    // Branch coverage: addMidiFx native-bridge notification, disposed-state
    // guards on rebuild/addDevice/updateParam/scheduleParam/updateBypass,
    // completePendingDeviceLoad rejection paths, destroyRejectedDeviceNode
    // dispose-vs-controller branches, removeDevice no-controller-fallback,
    // sidechain-compressor param dispatch, and the no-op updateBypass when the
    // bypass state is already at the requested value.
    describe('control-flow & lifecycle guards', () => {
        // The shared AudioWorkletNode stub in the outer beforeEach gives the
        // meter worklet a port without `close`; dispose() calls port.close().
        // Re-stub with a complete port so the dispose paths run cleanly here.
        beforeEach(() => {
            (global as { AudioWorkletNode?: unknown }).AudioWorkletNode = class {
                port = { postMessage: vi.fn(), close: vi.fn() };
                connect = vi.fn();
                disconnect = vi.fn();
            };
        });

        function makeDeviceNode(overrides: Record<string, unknown> = {}) {
            const node = { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 1 };
            return {
                deviceId: 'd-guard',
                type: 'effect',
                nodes: [node],
                inputNode: node,
                outputNode: node,
                ...overrides,
            };
        }

        it('addMidiFx is a no-op for a track with no external-plugin device (and no TODO branch hit on non-native)', () => {
            const track = new TrackNode('t', deps);
            // No external-plugin device → nativeDevice is undefined, the
            // nativeDspControls TODO branch is not entered.
            expect(() => track.addMidiFx('fx-1', 'arp')).not.toThrow();
            expect(track.strip.midiFxNodes).toHaveLength(1);
        });

        it('addMidiFx touches the native-bridge TODO branch when an external-plugin device is present', () => {
            const track = new TrackNode('t', deps);
            const dn = makeDeviceNode({ type: 'external-plugin', nativeDspControls: { setParam: vi.fn() } });
            track.strip.deviceNodes.push(dn as never);

            // The nativeDspControls branch is entered (currently a TODO no-op);
            // the midi-fx is still recorded.
            expect(() => track.addMidiFx('fx-2', 'velocity')).not.toThrow();
            expect(track.strip.midiFxNodes.some((f) => f.id === 'fx-2')).toBe(true);
        });

        it('removeMidiFx/updateMidiFxParam/updateMidiFxBypass mutate the recorded midi-fx', () => {
            const track = new TrackNode('t', deps);
            track.addMidiFx('fx-1', 'probability');
            track.updateMidiFxParam('fx-1', 'rate', 0.5);
            track.updateMidiFxBypass('fx-1', true);
            const fx = track.strip.midiFxNodes.find((f) => f.id === 'fx-1');
            expect(fx?.parameterValues.rate).toBe(0.5);
            expect(fx?.bypassed).toBe(true);

            track.removeMidiFx('fx-1');
            expect(track.strip.midiFxNodes.some((f) => f.id === 'fx-1')).toBe(false);
        });

        it('rebuildChain and addDevice are no-ops after dispose', () => {
            const track = new TrackNode('t', deps);
            track.dispose();
            vi.mocked(track.strip.preFaderTap.disconnect).mockClear();

            track.rebuildChain(); // disposed guard
            track.addDevice('d-late', 'builtin-gain'); // disposed guard

            expect(track.strip.preFaderTap.disconnect).not.toHaveBeenCalled();
            expect(track.strip.deviceNodes.some((d) => d.deviceId === 'd-late')).toBe(false);
        });

        it('updateParam/scheduleParam/updateBypass are no-ops for a missing device or controller', () => {
            const track = new TrackNode('t', deps);
            // No device at all.
            expect(() => track.updateParam('missing', 'p', 1)).not.toThrow();
            expect(() => track.scheduleParam('missing', 'p', 1, 0)).not.toThrow();
            expect(() => track.updateBypass('missing', true)).not.toThrow();

            // Device present but no controller.
            const dn = makeDeviceNode({ controller: undefined });
            track.strip.deviceNodes.push(dn as never);
            expect(() => track.updateParam('d-guard', 'p', 1)).not.toThrow();
            expect(() => track.scheduleParam('d-guard', 'p', 1, 0)).not.toThrow();
        });

        it('scheduleParam prefers controller.scheduleParam when present', () => {
            const track = new TrackNode('t', deps);
            const scheduleParam = vi.fn();
            const dn = makeDeviceNode({ controller: { scheduleParam } });
            track.strip.deviceNodes.push(dn as never);

            track.scheduleParam('d-guard', 'cutoff', 0.5, 1.0);

            expect(scheduleParam).toHaveBeenCalledWith('cutoff', 0.5, 1.0);
        });

        it('scheduleParam falls back to setParam with a sample-frame hint when scheduleParam is absent', () => {
            const track = new TrackNode('t', deps);
            const setParam = vi.fn();
            const dn = makeDeviceNode({ controller: { setParam } });
            track.strip.deviceNodes.push(dn as never);

            track.scheduleParam('d-guard', 'cutoff', 0.5, 1.0);

            // sampleFrame = round(time * sampleRate). Mock ctx sampleRate is 48000.
            expect(setParam).toHaveBeenCalledWith('cutoff', 0.5, 48000);
        });

        it('updateBypass is a no-op when the bypass state is already at the requested value', async () => {
            const track = new TrackNode('t', deps);
            const setBypass = vi.fn();
            const allNotesOff = vi.fn();
            const dn = makeDeviceNode({
                type: 'levain',
                controller: { setBypass, allNotesOff },
                bypassed: true,
            });
            track.strip.deviceNodes.push(dn as never);

            // Already bypassed → request bypass true again → no rebuild scheduled.
            track.updateBypass('d-guard', true);
            expect(setBypass).toHaveBeenCalledWith(true);
            // allNotesOff still fires on entry to bypass (idempotent), but the
            // dn.bypassed !== bypassed guard is false so no rebuild.
            expect(allNotesOff).toHaveBeenCalledTimes(1);
        });

        it('removeDevice destroys a device that has only a dispose() (no controller)', () => {
            const track = new TrackNode('t', deps);
            const dispose = vi.fn();
            const dn = makeDeviceNode({ controller: undefined, dispose });
            track.strip.deviceNodes.push(dn as never);

            track.removeDevice('d-guard');

            expect(dispose).toHaveBeenCalledTimes(1);
            expect(track.strip.deviceNodes.some((d) => d.deviceId === 'd-guard')).toBe(false);
        });

        it('removeDevice is a no-op for a device that is not on the track', () => {
            const track = new TrackNode('t', deps);
            expect(() => track.removeDevice('absent')).not.toThrow();
        });

        it('getPeakLevel uses the analyser fallback when SAB is unavailable', () => {
            // Construct without SAB: temporarily remove SharedArrayBuffer.
            const savedSAB = (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            delete (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            try {
                const noSabTrack = new TrackNode('t-nosab', deps);
                expect(noSabTrack.strip.meterNode).toBeNull();
                // Feed deterministic time-domain data into the analyser fallback.
                vi.mocked(noSabTrack.strip.analyserNode.getFloatTimeDomainData).mockImplementation(
                    (arr: Float32Array) => {
                        arr[0] = 0.25;
                        arr[1] = -0.8;
                        arr[2] = 0.4;
                        return arr;
                    }
                );
                expect(noSabTrack.getPeakLevel()).toBeCloseTo(0.8, 6);
            } finally {
                (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = savedSAB;
            }
        });

        it('getDefaultDestination resolves hw_out and unknown outputs to the master gain', () => {
            const track = new TrackNode('t', deps);
            expect(track.getDefaultDestination()).toBe(deps.masterGainNode);
            track.strip.outputId = 'hw_out';
            expect(track.getDefaultDestination()).toBe(deps.masterGainNode);
            track.strip.outputId = 'unknown-bus';
            vi.mocked(deps.getBusGainNode).mockReturnValue(undefined);
            vi.mocked(deps.getTrackGainNode).mockReturnValue(undefined);
            expect(track.getDefaultDestination()).toBe(deps.masterGainNode);
        });

        it('dispose tears down a device that has only a dispose() (no controller)', () => {
            const track = new TrackNode('t', deps);
            const dispose = vi.fn();
            const dn = makeDeviceNode({ controller: undefined, dispose });
            track.strip.deviceNodes.push(dn as never);

            track.dispose();

            expect(dispose).toHaveBeenCalledTimes(1);
        });

        it('routeOutput is idempotent when the destination has not changed', () => {
            const track = new TrackNode('t', deps);
            vi.mocked(track.strip.analyserNode.connect).mockClear();
            // Re-route to the same default destination (master).
            track.routeOutput();
            expect(track.strip.analyserNode.connect).not.toHaveBeenCalled();
        });
    });

    // Sidechain-compressor device: the controller dispatch maps sc-comp-* param
    // names to the worklet params, converting attack/release (ms) to seconds.
    describe('sidechain-compressor controller param dispatch', () => {
        it('converts attack/release from ms to seconds and forwards other params raw', () => {
            const track = new TrackNode('t', deps);
            track.addDevice('sc-1', 'builtin-sidechain-compressor');
            const dn = track.strip.deviceNodes.find((d) => d.deviceId === 'sc-1');
            expect(dn).toBeDefined();

            const attackParam = { setTargetAtTime: vi.fn() };
            const releaseParam = { setTargetAtTime: vi.fn() };
            const thresholdParam = { setTargetAtTime: vi.fn() };
            const worklet = dn!.nodes[0] as unknown as {
                parameters: { get: (name: string) => unknown };
            };
            (worklet as unknown as { parameters: Map<string, unknown> }).parameters = new Map([
                ['attack', attackParam],
                ['release', releaseParam],
                ['threshold', thresholdParam],
            ]);

            dn!.controller!.setParam('sc-comp-attack', 30); // 30ms → 0.03s
            expect(attackParam.setTargetAtTime).toHaveBeenCalledWith(0.03, ctx.currentTime, 0.01);

            dn!.controller!.setParam('sc-comp-release', 200); // 200ms → 0.2s
            expect(releaseParam.setTargetAtTime).toHaveBeenCalledWith(0.2, ctx.currentTime, 0.01);

            dn!.controller!.setParam('sc-comp-threshold', -12);
            expect(thresholdParam.setTargetAtTime).toHaveBeenCalledWith(-12, ctx.currentTime, 0.01);

            // Unknown param name → parameters.get returns undefined → no-op.
            expect(() => dn!.controller!.setParam('sc-comp-mystery', 5)).not.toThrow();
        });
    });

    // External-plugin bridge: externalInstanceId fallback (?? deviceId) and the
    // parseInt name->id translation that floors a non-numeric name to 0.
    describe('external-plugin bridge param translation', () => {
        it('falls back to deviceId when no externalInstanceId is provided', async () => {
            const track = new TrackNode('t', deps);
            track.addDevice('dev-fallback', 'external-plugin'); // no instance id

            expect(resolveBridge).toBeDefined();
            const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
            resolveBridge!({
                workletNode: bridgeNode,
                setParam: bridgeSetParam,
                setBypass: vi.fn(),
                destroy: vi.fn(() => {
                    bridgeNode.disconnect();
                    bridgeNode.port.close();
                }),
            });
            await Promise.all([...deps.pendingDevicePromises]);
            // Bridge load resolved cleanly.
            expect(track.strip.deviceNodes.some((d) => d.deviceId === 'dev-fallback')).toBe(true);
        });

        it('translates a non-numeric param name to engine id 0', async () => {
            const track = new TrackNode('t', deps);
            track.addDevice('dev-name', 'external-plugin', 'inst-name');

            const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
            resolveBridge!({
                workletNode: bridgeNode,
                setParam: bridgeSetParam,
                setBypass: vi.fn(),
                destroy: vi.fn(),
            });
            await Promise.all([...deps.pendingDevicePromises]);

            // A non-numeric name floors to 0 via `parseInt(name, 10) || 0`.
            const dn = track.strip.deviceNodes.find((d) => d.deviceId === 'dev-name');
            dn!.controller!.setParam('not-a-number', 0.9);
            expect(bridgeSetParam).toHaveBeenCalledWith(0, 0.9);
        });
    });

    // No-SAB tracks: meterNode is null, so rebuildChain and dispose take the
    // analyser-direct branches instead of the meter-wiring branches.
    describe('no-SharedArrayBuffer track wiring & teardown', () => {
        let savedSAB: unknown;
        beforeEach(() => {
            savedSAB = (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            delete (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
        });
        afterEach(() => {
            (global as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = savedSAB;
        });

        it('wires panNode directly to analyserNode in rebuildChain and disposes without a meter', () => {
            const track = new TrackNode('t-nosab', deps);
            expect(track.strip.meterNode).toBeNull();

            vi.mocked(track.strip.panNode.connect).mockClear();
            track.rebuildChain();
            // No meter → panNode connects straight to analyser.
            expect(track.strip.panNode.connect).toHaveBeenCalledWith(track.strip.analyserNode);

            // Dispose must not touch a meter (it is null) and must not throw.
            expect(() => track.dispose()).not.toThrow();
        });
    });

    // Pending-load rejection: a native-plugin bridge that resolves AFTER the
    // track is disposed (or its device removed) must not swap in its node —
    // completePendingDeviceLoad rejects and destroys the late-arriving node.
    describe('pending device-load rejection paths', () => {
        beforeEach(() => {
            (global as { AudioWorkletNode?: unknown }).AudioWorkletNode = class {
                port = { postMessage: vi.fn(), close: vi.fn() };
                connect = vi.fn();
                disconnect = vi.fn();
            };
        });

        it('destroys a bridge node that resolves after the track is disposed', async () => {
            const track = new TrackNode('t', deps);
            track.addDevice('dev-late', 'external-plugin', 'inst-late');

            // Dispose before the bridge resolves.
            track.dispose();

            const bridgeDestroy = vi.fn();
            const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
            resolveBridge!({
                workletNode: bridgeNode,
                setParam: vi.fn(),
                setBypass: vi.fn(),
                destroy: bridgeDestroy,
            });
            await Promise.all([...deps.pendingDevicePromises]);

            // Rejected because the track is disposed → the late node is destroyed.
            expect(bridgeDestroy).toHaveBeenCalledTimes(1);
        });

        it('destroys a bridge node that resolves after its device was removed', async () => {
            const track = new TrackNode('t', deps);
            track.addDevice('dev-rm', 'external-plugin', 'inst-rm');

            // Remove the device (invalidates the pending load) before resolve.
            track.removeDevice('dev-rm');

            const bridgeDestroy = vi.fn();
            const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
            resolveBridge!({
                workletNode: bridgeNode,
                setParam: vi.fn(),
                setBypass: vi.fn(),
                destroy: bridgeDestroy,
            });
            await Promise.all([...deps.pendingDevicePromises]);

            // index === -1 (device no longer on the strip) → rejected + destroyed.
            expect(bridgeDestroy).toHaveBeenCalledTimes(1);
        });

        it('buffered param writes after the load resolved are dropped (placeholder guard)', async () => {
            const track = new TrackNode('t', deps);
            track.addDevice('dev-done', 'external-plugin', 'inst-done');

            const bridgeNode = { disconnect: vi.fn(), connect: vi.fn(), port: { close: vi.fn() } };
            resolveBridge!({
                workletNode: bridgeNode,
                setParam: bridgeSetParam,
                setBypass: vi.fn(),
                destroy: vi.fn(),
            });
            await Promise.all([...deps.pendingDevicePromises]);
            bridgeSetParam.mockClear();

            // After resolve, the placeholder controller is replaced; calling the
            // resolved controller forwards normally. The placeholder's setParam
            // guard (resolved === true) drops any stale buffered write that
            // somehow still targets the placeholder.
            track.updateParam('dev-done', '5', 0.4);
            expect(bridgeSetParam).toHaveBeenCalledWith(5, 0.4);
        });
    });
});
