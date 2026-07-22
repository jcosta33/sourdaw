import { describe, it, expect, vi } from 'vitest';

import { createOfflineBusStrip } from '../createOfflineBusStrip';

import type { OfflineTrackStrip } from '../types';

describe('createOfflineBusStrip', () => {
    it('uses the owning offline track input without creating a parallel master path', () => {
        const inputNode = { connect: vi.fn() } as unknown as GainNode;
        const trackStrip = { inputNode } as OfflineTrackStrip;

        const strip = createOfflineBusStrip(trackStrip);

        expect(strip.gainNode).toBe(inputNode);
        expect(inputNode.connect).not.toHaveBeenCalled();
    });
});
