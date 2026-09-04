import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { createDeviceReadinessDiagnostics } from '../deviceReadinessDiagnostics';
import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, TrackNode, type TrackNodeDeps } from '../TrackNode';

// An external-plugin device is a synchronous Web Audio pass-through whose only
// traffic is control IPC (#3564). Mock that IPC so the spec can read the param
// ids and values that actually reach the native instance.
const setPluginParameter = vi.hoisted(() => vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()));
const setPluginBypass = vi.hoisted(() => vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()));
vi.mock('#/modules/PluginHost/useCases', () => ({
    setPluginParameter,
    setPluginBypass,
    // The wasm device registry and the Faust device resolver read the barrel's
    // Faust half at module scope; no device under test is a Faust module, so it
    // answers "not one of mine" and its builders are never reached.
    isFaustModule: () => false,
    getFaustModuleLatencyMs: () => 0,
    compileFaustDSP: () => Promise.reject(new Error('unexpected Faust compile')),
    createFaustNode: () => Promise.reject(new Error('unexpected Faust node')),
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
        setPluginParameter.mockResolvedValue(undefined);
        setPluginBypass.mockResolvedValue(undefined);
    });

    it('should create and wire up nodes correctly on initialization', () => {
        const track = new TrackNode('track-1', deps);

        expect(track.trackId).toBe('track-1');
        expect(track.strip.muted).toBe(false);

        // Initial wiring check (simplified)
        // gainNode -> preFaderTap -> faderNode -> postFaderGain -> panNode -> meterNode -> analyserNode -> carrierGate -> masterGain
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
        // The destination hangs off the carrier gate, not off the analyser: the
        // analyser has to keep metering a track the native engine is carrying.
        expect(track.strip.analyserNode.connect).toHaveBeenCalledWith(track.strip.carrierGate);
        expect(track.strip.carrierGate.connect).toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.analyserNode.connect).not.toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.preFaderTap.connect).toHaveBeenCalledWith(track.strip.preFaderSendGate);
    });

    describe('native-carrier gates', () => {
        it('closes both exits when the native engine takes the track and reopens them when it gives it back', () => {
            const track = new TrackNode('track-1', deps);

            track.setNativeCarried(true);

            expect(track.strip.nativeCarried).toBe(true);
            expect(track.strip.carrierGate.gain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.005);
            expect(track.strip.preFaderSendGate.gain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.005);
            // `setTargetAtTime` is exponential and never actually arrives, so a
            // gate driven by it alone leaks a decaying tail of a track the
            // native engine is already sounding — audible against it, and
            // audible forever. The landing event is what ends the ramp.
            expect(track.strip.carrierGate.gain.setValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime + 0.05);
            expect(track.strip.preFaderSendGate.gain.setValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime + 0.05);

            track.setNativeCarried(false);

            expect(track.strip.nativeCarried).toBe(false);
            expect(track.strip.carrierGate.gain.setTargetAtTime).toHaveBeenCalledWith(1, ctx.currentTime, 0.005);
            expect(track.strip.preFaderSendGate.gain.setTargetAtTime).toHaveBeenCalledWith(1, ctx.currentTime, 0.005);
            expect(track.strip.carrierGate.gain.setValueAtTime).toHaveBeenCalledWith(1, ctx.currentTime + 0.05);
            expect(track.strip.preFaderSendGate.gain.setValueAtTime).toHaveBeenCalledWith(1, ctx.currentTime + 0.05);
        });

        it('drops the pending landing before ramping back, so a reversal cannot snap to the stale target', () => {
            // The session claims its strips before the batch is applied and
            // hands them back a bridge round trip later when the engine
            // declines — a reversal well inside the 50 ms landing window. Left
            // scheduled, the close's landing fires in the middle of the reopen
            // and pins the gate to zero until this call's own landing releases
            // it, so the track the musician was promised back stays silent.
            const track = new TrackNode('track-1', deps);
            track.setNativeCarried(true);

            const gates = [track.strip.carrierGate.gain, track.strip.preFaderSendGate.gain];
            for (const gate of gates) {
                vi.mocked(gate.cancelScheduledValues).mockClear();
                vi.mocked(gate.setValueAtTime).mockClear();
                vi.mocked(gate.setTargetAtTime).mockClear();
            }
            ctx.currentTime = 0.002;

            track.setNativeCarried(false);

            for (const gate of gates) {
                expect(gate.cancelScheduledValues).toHaveBeenCalledWith(0.002);
                // Re-anchored at where the gate actually is, and before the new
                // ramp — an anchor scheduled after it would overwrite its start.
                expect(gate.setValueAtTime).toHaveBeenNthCalledWith(1, gate.value, 0.002);
                expect(vi.mocked(gate.setValueAtTime).mock.invocationCallOrder[0]).toBeLessThan(
                    vi.mocked(gate.setTargetAtTime).mock.invocationCallOrder[0]!
                );
            }
        });

        it('leaves the mute and solo gates alone, so carrying cannot clear either', () => {
            const track = new TrackNode('track-1', deps);
            vi.mocked(track.strip.postFaderGain.gain.setTargetAtTime).mockClear();
            vi.mocked(track.strip.preFaderTap.gain.setTargetAtTime).mockClear();

            track.setNativeCarried(true);

            expect(track.strip.postFaderGain.gain.setTargetAtTime).not.toHaveBeenCalled();
            expect(track.strip.preFaderTap.gain.setTargetAtTime).not.toHaveBeenCalled();
        });

        it('keeps the analyser→carrierGate edge across a chain rebuild', () => {
            const track = new TrackNode('track-1', deps);
            track.setNativeCarried(true);

            track.rebuildChain();

            // rebuildChain never disconnects the analyser, so the gate — and the
            // closed state it holds — survives without being re-driven.
            expect(track.strip.analyserNode.disconnect).not.toHaveBeenCalled();
            expect(track.strip.preFaderTap.connect).toHaveBeenCalledWith(track.strip.preFaderSendGate);
        });
    });

    it('should set gain with clamping', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;

        track.setGain(0.5);
        expect(faderGain.setTargetAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime, 0.01);

        // 1.5 is inside the fader's +6 dB headroom now, so it passes through
        // unclamped — the fader is no longer dead travel above unity.
        track.setGain(1.5);
        expect(faderGain.setTargetAtTime).toHaveBeenCalledWith(1.5, ctx.currentTime, 0.01);

        // A value past the ceiling still clamps, just at the new ceiling.
        track.setGain(2.5);
        expect(faderGain.setTargetAtTime).toHaveBeenCalledWith(FADER_MAX_GAIN, ctx.currentTime, 0.01);
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

    it('RT-5: clamps a scheduled gain to the fader ceiling, not to unity', () => {
        const track = new TrackNode('track-1', deps);
        const faderGain = track.strip.faderNode.gain;

        // Inside the +6 dB headroom: passes through unclamped.
        track.scheduleGainAutomation(1.5, ctx.currentTime + 0.02);
        expect(faderGain.linearRampToValueAtTime).toHaveBeenCalledWith(1.5, ctx.currentTime + 0.02);

        // Past the ceiling: clamps at the ceiling, not at 1.
        track.scheduleGainAutomation(2.5, ctx.currentTime + 0.02);
        expect(faderGain.linearRampToValueAtTime).toHaveBeenCalledWith(FADER_MAX_GAIN, ctx.currentTime + 0.02);
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
        expect(track.strip.carrierGate.connect).toHaveBeenCalledWith(busGain);
    });

    it('disconnects only its previous output destination when rerouting', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);

        track.setOutput('bus-1');

        expect(track.strip.carrierGate.disconnect).toHaveBeenCalledTimes(1);
        expect(track.strip.carrierGate.disconnect).toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.carrierGate.disconnect).not.toHaveBeenCalledWith();
    });

    it('reports a rejected output mutation after restoring its previous live route', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);
        const connectError = new Error('output connect failed');
        vi.mocked(track.strip.carrierGate.connect).mockClear();
        vi.mocked(track.strip.carrierGate.disconnect).mockClear();
        vi.mocked(track.strip.carrierGate.connect).mockImplementationOnce(() => {
            throw connectError;
        });

        expect(() => track.setOutput('bus-1')).toThrow(RuntimeGraphMutationRejected);
        expect(track.strip.outputId).toBeUndefined();
        expect(track.strip.carrierGate.disconnect).toHaveBeenCalledWith(deps.masterGainNode);
        expect(track.strip.carrierGate.connect).toHaveBeenLastCalledWith(deps.masterGainNode);
    });

    it('reports an uncompensated output mutation when restoring its previous live route fails', () => {
        const busGain = ctx.createGain();
        vi.mocked(deps.getBusGainNode).mockReturnValue(busGain as unknown as GainNode);
        const track = new TrackNode('track-1', deps);
        const connectError = new Error('output connect failed');
        const restoreError = new Error('output restore failed');
        vi.mocked(track.strip.carrierGate.connect).mockClear();
        vi.mocked(track.strip.carrierGate.disconnect).mockClear();
        vi.mocked(track.strip.carrierGate.connect)
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
        vi.mocked(track.strip.carrierGate.connect).mockClear();
        vi.mocked(track.strip.carrierGate.disconnect).mockImplementationOnce(() => {
            throw new Error('output disconnect failed');
        });

        expect(() => track.setOutput('bus-1')).toThrow(RuntimeGraphMutationRejected);
        expect(track.strip.outputId).toBeUndefined();
        expect(track.strip.carrierGate.connect).not.toHaveBeenCalled();
    });

    it('preserves carrier-gate output, send, and sidechain edges across a chain rebuild', () => {
        const track = new TrackNode('track-1', deps);
        const unrelatedEdge = ctx.createGain();
        track.strip.carrierGate.connect(unrelatedEdge as unknown as AudioNode);
        vi.mocked(track.strip.analyserNode.disconnect).mockClear();
        vi.mocked(track.strip.carrierGate.disconnect).mockClear();

        track.rebuildChain();

        expect(track.strip.analyserNode.disconnect).not.toHaveBeenCalledWith();
        expect(track.strip.carrierGate.disconnect).not.toHaveBeenCalledWith();
        expect(track.strip.carrierGate.disconnect).not.toHaveBeenCalledWith(unrelatedEdge);
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

    // Live reload (ensureTrackStrips) adds the external-plugin device and then
    // immediately replays saved Track.devices[*].parameterValues via updateParam.
    // The device is a synchronous pass-through, so there is no loading window for
    // those writes to fall into: each one reaches the instance as it is made.
    it('sends saved params to the hosted instance as they are written, with no loading window', () => {
        const track = new TrackNode('track-1', deps);

        track.addDevice('dev-1', 'external-plugin', 'inst-1');
        track.updateParam('dev-1', '3', 0.75);
        track.updateParam('dev-1', '7', -2);

        expect(setPluginParameter).toHaveBeenCalledWith({ instanceId: 'inst-1', paramId: 3, value: 0.75 });
        expect(setPluginParameter).toHaveBeenCalledWith({ instanceId: 'inst-1', paramId: 7, value: -2 });
        expect(setPluginParameter).toHaveBeenCalledTimes(2);
    });

    it('passes audio through the external-plugin device untouched, because the engine sounds the plugin', () => {
        // Nothing leaves this process and comes back any more. A device that
        // still inserted a bridge node here would delay the strip by a round
        // trip the mix is no longer paying for.
        const track = new TrackNode('track-1', deps);

        track.addDevice('dev-1', 'external-plugin', 'inst-1');

        const dn = track.strip.deviceNodes.find((device) => device.deviceId === 'dev-1');
        // One node, and the same node at both ends of the slot. A relay would
        // put an AudioWorkletNode here instead — which carries a message port,
        // and whose construction is what registers the async device load.
        expect(dn?.nodes).toHaveLength(1);
        expect(dn?.inputNode).toBe(dn?.outputNode);
        expect(dn?.outputNode).not.toHaveProperty('port');
        expect(deps.pendingDevicePromises.size).toBe(0);
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

    // Hosted external plugin: the name->id translation, which addresses a
    // numeric id exactly and refuses every other spelling rather than flooring
    // it to parameter 0, and the instance-less device that must reach no IPC.
    describe('external-plugin hosted param translation', () => {
        function hostedController(deviceId: string): { setParam: (name: string, value: number) => void } {
            const track = new TrackNode('t', deps);
            track.addDevice(deviceId, 'external-plugin', `inst-${deviceId}`);

            const dn = track.strip.deviceNodes.find((device) => device.deviceId === deviceId);
            if (!dn?.controller) {
                throw new Error(`expected a hosted plugin controller for ${deviceId}`);
            }
            return dn.controller;
        }

        it('sends nothing at all for a device that names no instance', () => {
            // A device id is not an instance id, and addressing the IPC with one
            // would write a parameter on whatever instance happened to answer to
            // that name.
            const track = new TrackNode('t', deps);
            track.addDevice('dev-fallback', 'external-plugin');

            const dn = track.strip.deviceNodes.find((device) => device.deviceId === 'dev-fallback');
            expect(dn).toBeDefined();
            dn!.controller!.setParam('3', 0.5);
            dn!.controller!.setBypass?.(true);

            expect(setPluginParameter).not.toHaveBeenCalled();
            expect(setPluginBypass).not.toHaveBeenCalled();
        });

        it('addresses a numeric param name as exactly that native parameter id', () => {
            const controller = hostedController('dev-numeric');

            controller.setParam('7', 0.25);
            expect(setPluginParameter).toHaveBeenCalledWith({
                instanceId: 'inst-dev-numeric',
                paramId: 7,
                value: 0.25,
            });

            // Not an index into the parameter list: id 0 is only reached by the
            // name '0'.
            controller.setParam('0', 0.5);
            expect(setPluginParameter).toHaveBeenCalledWith({ instanceId: 'inst-dev-numeric', paramId: 0, value: 0.5 });
            expect(setPluginParameter).toHaveBeenCalledTimes(2);
        });

        it('refuses a param name that is not a parameter id instead of writing parameter 0', () => {
            const controller = hostedController('dev-name');

            // Every one of these answered `0` under `parseInt(name, 10) || 0`:
            // the non-numeric ones through the `|| 0`, and the numeric-prefixed
            // and fractional ones by silently addressing a parameter nobody
            // named.
            for (const refused of ['not-a-number', '', ' 3', '3abc', '3.7', '-1', '1e3', '0x2']) {
                controller.setParam(refused, 0.9);
            }

            expect(setPluginParameter).not.toHaveBeenCalled();
        });

        it('reports each refused param name once, however many times it is written', () => {
            const controller = hostedController('dev-repeat');
            const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

            // A refused write arrives from the scheduler's tick grid, so a
            // report per occurrence would bury the session log under one
            // repeated fault at 100 Hz.
            controller.setParam('not-a-number', 0.1);
            controller.setParam('not-a-number', 0.2);

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]![0]).toContain('not-a-number');

            // Per name, not once per device: a second bad name is a second
            // fault and still has to be reported.
            controller.setParam('another-bad-name', 0.3);

            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls[1]![0]).toContain('another-bad-name');
            expect(setPluginParameter).not.toHaveBeenCalled();

            warn.mockRestore();
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
});
