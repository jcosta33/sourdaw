import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { TrackNode, type TrackNodeDeps } from '../TrackNode';

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
});
