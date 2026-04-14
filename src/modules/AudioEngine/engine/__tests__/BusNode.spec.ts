import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusNode } from '../BusNode';
import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';

describe('BusNode', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let masterGain: GainNode;

    beforeEach(() => {
        ctx = createMockAudioContext();
        masterGain = ctx.createGain() as any;
        vi.clearAllMocks();
    });

    it('should create and wire up nodes correctly', () => {
        const bus = new BusNode('bus-1', ctx as any, masterGain);
        
        expect(ctx.createGain).toHaveBeenCalled();
        expect(ctx.createAnalyser).toHaveBeenCalled();
        expect(bus.strip.busId).toBe('bus-1');
        
        // gain -> analyser -> master
        expect(bus.strip.gainNode.connect).toHaveBeenCalledWith(bus.strip.analyserNode);
        expect(bus.strip.analyserNode.connect).toHaveBeenCalledWith(masterGain);
    });

    it('should set gain using setTargetAtTime', () => {
        const bus = new BusNode('bus-1', ctx as any, masterGain);
        const gainParam = bus.strip.gainNode.gain;
        
        bus.setGain(0.5);
        expect(gainParam.setTargetAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime, 0.01);
    });

    it('should clamp gain values', () => {
        const bus = new BusNode('bus-1', ctx as any, masterGain);
        const gainParam = bus.strip.gainNode.gain;
        
        bus.setGain(-1);
        expect(gainParam.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.01);
        
        bus.setGain(3);
        expect(gainParam.setTargetAtTime).toHaveBeenCalledWith(2, ctx.currentTime, 0.01);
    });

    it('should calculate peak level from analyser data', () => {
        const bus = new BusNode('bus-1', ctx as any, masterGain);
        const analyser = bus.strip.analyserNode;
        
        // Mock analyser data: peak is 0.8
        vi.mocked(analyser.getFloatTimeDomainData).mockImplementation((data: Float32Array) => {
            data[0] = 0.1;
            data[1] = -0.8;
            data[2] = 0.5;
        });

        const peak = bus.getPeakLevel();
        expect(peak).toBeCloseTo(0.8, 5);
    });

    it('should disconnect nodes on dispose', () => {
        const bus = new BusNode('bus-1', ctx as any, masterGain);
        bus.dispose();
        
        expect(bus.strip.gainNode.disconnect).toHaveBeenCalled();
        expect(bus.strip.analyserNode.disconnect).toHaveBeenCalled();
    });
});
