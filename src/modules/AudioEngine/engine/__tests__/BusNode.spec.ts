import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { BusNode } from '../BusNode';

import type { TrackNode } from '../TrackNode';

describe('BusNode', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;
    let trackNode: TrackNode;

    beforeEach(() => {
        ctx = createMockAudioContext();
        const gainNode = ctx.createGain();
        const analyserNode = ctx.createAnalyser();
        trackNode = {
            strip: {
                gainNode,
                analyserNode,
            },
            setGain: vi.fn(),
            getPeakLevel: vi.fn(() => 0.8),
        } as unknown as TrackNode;
        vi.clearAllMocks();
    });

    it('uses the owning track strip as the bus input and meter path', () => {
        const bus = new BusNode('bus-1', trackNode);

        expect(bus.strip.busId).toBe('bus-1');
        expect(bus.strip.gainNode).toBe(trackNode.strip.gainNode);
        expect(bus.strip.analyserNode).toBe(trackNode.strip.analyserNode);
    });

    it('sets gain through the owning track fader', () => {
        const bus = new BusNode('bus-1', trackNode);

        bus.setGain(0.5);
        expect(trackNode.setGain).toHaveBeenCalledWith(0.5);
    });

    it('reads peak level from the owning track meter', () => {
        const bus = new BusNode('bus-1', trackNode);

        const peak = bus.getPeakLevel();
        expect(peak).toBeCloseTo(0.8, 5);
    });

    it('does not dispose nodes owned by the paired track strip', () => {
        const bus = new BusNode('bus-1', trackNode);
        bus.dispose();

        expect(bus.strip.gainNode.disconnect).not.toHaveBeenCalled();
        expect(bus.strip.analyserNode.disconnect).not.toHaveBeenCalled();
    });
});
