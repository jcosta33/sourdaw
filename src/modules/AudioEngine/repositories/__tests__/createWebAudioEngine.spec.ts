import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockAudioContext } from '../../helpers/__tests__/audioContext.mock';

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

// We need to stub global AudioContext before importing the engine
const mockCtx = createMockAudioContext();
vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

import { audioEngine } from '../createWebAudioEngine';

describe('AudioEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        audioEngine.resetGraph();
    });

    it('should initialize with master nodes', () => {
        expect(audioEngine.context).toBeDefined();
        expect(audioEngine.masterGainNode).toBeDefined();
        expect(audioEngine.masterAnalyser).toBeDefined();
        expect(mockCtx.createGain).toHaveBeenCalled();
        expect(mockCtx.createAnalyser).toHaveBeenCalled();
    });

    it('should load worklets on initialize', async () => {
        await audioEngine.initialize();
        expect(mockCtx.audioWorklet.addModule).toHaveBeenCalledTimes(4);
    });

    it('should manage master gain', () => {
        audioEngine.setMasterGain(0.5);
        expect(mockCtx.createGain().gain.setTargetAtTime).toHaveBeenCalledWith(0.5, expect.any(Number), 0.01);
        
        vi.mocked(mockCtx.createGain().gain).value = 0.5;
        expect(audioEngine.getMasterGain()).toBe(0.5);
    });

    it('should ensure and remove track strips', () => {
        const strip = audioEngine.ensureTrackStrip('t1');
        expect(strip.trackId).toBe('t1');
        
        const retrieved = audioEngine.getTrackStrip('t1');
        expect(retrieved).toBe(strip);
        
        audioEngine.removeTrackStrip('t1');
        expect(audioEngine.getTrackStrip('t1')).toBeUndefined();
    });

    it('should ensure and remove bus strips', () => {
        const strip = audioEngine.ensureBusStrip('b1');
        expect(strip.busId).toBe('b1');
        
        audioEngine.removeBusStrip('b1');
        // No direct getter for bus strips in AudioEngine public API other than ensure
    });

    it('should delegate track parameters', () => {
        audioEngine.ensureTrackStrip('t1');
        audioEngine.setTrackGain('t1', 0.8);
        audioEngine.setTrackPan('t1', -20);
        audioEngine.setTrackMute('t1', true);
        
        const trackNode = (audioEngine as any).trackNodes.get('t1');
        expect(trackNode.setGain).toHaveBeenCalledWith(0.8);
        expect(trackNode.setPan).toHaveBeenCalledWith(-20);
        expect(trackNode.setMute).toHaveBeenCalledWith(true);
    });

    it('should handle master peak level', () => {
        const peak = audioEngine.getMasterPeakLevel();
        expect(mockCtx.createAnalyser().getFloatTimeDomainData).toHaveBeenCalled();
        expect(typeof peak).toBe('number');
    });

    it('should reset graph', () => {
        audioEngine.ensureTrackStrip('t1');
        audioEngine.ensureBusStrip('b1');
        
        audioEngine.resetGraph();
        
        expect(audioEngine.getTrackStrip('t1')).toBeUndefined();
        expect((audioEngine as any).busNodes.size).toBe(0);
    });
});
