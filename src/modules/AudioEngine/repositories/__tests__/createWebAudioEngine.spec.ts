import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';

// Mock TrackNode and BusNode to avoid deep dependencies
vi.mock('../engine/TrackNode', () => ({
    TrackNode: vi.fn().mockImplementation((id) => ({
        trackId: id,
        strip: { trackId: id, deviceNodes: [] },
        dispose: vi.fn(),
        setGain: vi.fn(),
        setPan: vi.fn(),
        setMute: vi.fn(),
        getPeakLevel: vi.fn().mockReturnValue(0.5),
    })),
}));

vi.mock('../engine/BusNode', () => ({
    BusNode: vi.fn().mockImplementation((id) => ({
        busId: id,
        strip: { busId: id, gainNode: { connect: vi.fn() } },
        dispose: vi.fn(),
        setGain: vi.fn(),
        getPeakLevel: vi.fn().mockReturnValue(0.3),
    })),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

import { createAudioEngine } from '../createWebAudioEngine';

describe('AudioEngine', () => {
    let engine: any;
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCtx = createMockAudioContext();

        (global as any).AudioWorkletNode = class {
            port = { postMessage: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        };
        (global as any).SharedArrayBuffer = class extends ArrayBuffer {};

        engine = createAudioEngine(mockCtx as any);
    });

    it('should initialize with master nodes', () => {
        expect(engine.context).toBeDefined();
        expect(engine.masterGainNode).toBeDefined();
        expect(engine.masterAnalyser).toBeDefined();
        expect(mockCtx.createGain).toHaveBeenCalled();
        expect(mockCtx.createAnalyser).toHaveBeenCalled();
    });

    it('should load worklets on initialize', async () => {
        await engine.initialize();
        expect(mockCtx.audioWorklet.addModule).toHaveBeenCalledTimes(5);
    });

    it('should manage master gain', () => {
        engine.setMasterGain(0.5);
        expect(engine.masterGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, expect.any(Number), 0.01);
        
        engine.masterGainNode.gain.value = 0.5;
        expect(engine.getMasterGain()).toBe(0.5);
    });

    it('should ensure and remove track strips', () => {
        const strip = engine.ensureTrackStrip('t1');
        expect(strip.trackId).toBe('t1');
        
        const retrieved = engine.getTrackStrip('t1');
        expect(retrieved).toBe(strip);
        
        engine.removeTrackStrip('t1');
        expect(engine.getTrackStrip('t1')).toBeUndefined();
    });

    it('should handle master peak level', () => {
        const peak = engine.getMasterPeakLevel();
        expect(typeof peak).toBe('number');
    });
});
