import { describe, it, expect, vi } from 'vitest';
import { createOfflineBusStrip } from '../createOfflineBusStrip';

describe('createOfflineBusStrip', () => {
    it('should create a gain node, clamp gain to [0, 2], and connect to master', () => {
        const gainNode = {
            gain: { value: 0 },
            connect: vi.fn(),
        };
        const offlineCtx = {
            createGain: vi.fn(() => gainNode),
        } as unknown as OfflineAudioContext;

        const masterGain = { tag: 'master' } as unknown as GainNode;

        const strip = createOfflineBusStrip(offlineCtx, 0.5, masterGain);

        expect(offlineCtx.createGain).toHaveBeenCalledTimes(1);
        expect(gainNode.gain.value).toBe(0.5);
        expect(gainNode.connect).toHaveBeenCalledWith(masterGain);
        expect(strip.gainNode).toBe(gainNode);
    });

    it('should clamp track gain above 2 down to 2', () => {
        const gainNode = {
            gain: { value: 0 },
            connect: vi.fn(),
        };
        const offlineCtx = {
            createGain: vi.fn(() => gainNode),
        } as unknown as OfflineAudioContext;

        createOfflineBusStrip(offlineCtx, 10, {} as GainNode);

        expect(gainNode.gain.value).toBe(2);
    });
});
