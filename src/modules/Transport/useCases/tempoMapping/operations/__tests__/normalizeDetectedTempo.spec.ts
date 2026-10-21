import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateTransportState } from '../../../../repositories/transport/updateTransportState';
import { normalizeDetectedTempo } from '../normalizeDetectedTempo';

vi.mock('../../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('normalizeDetectedTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns no base tempo when transport state is missing', () => {
        const bpm = normalizeDetectedTempo(
            {
                points: [],
                averageBpm: 128,
                minBpm: 120,
                maxBpm: 130,
                confidence: 0.85,
                totalBeats: 16,
            },
            false
        );

        expect(bpm).toBeNull();
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('returns rounded BPM without writing when average BPM is positive', () => {
        const bpm = normalizeDetectedTempo(
            {
                points: [],
                averageBpm: 128.4,
                minBpm: 120,
                maxBpm: 130,
                confidence: 0.85,
                totalBeats: 16,
            },
            true
        );

        expect(bpm).toBe(128);
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should not update when average BPM is zero', () => {
        const bpm = normalizeDetectedTempo(
            {
                points: [],
                averageBpm: 0,
                minBpm: 0,
                maxBpm: 0,
                confidence: 0,
                totalBeats: 0,
            },
            true
        );

        expect(bpm).toBeNull();
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should clamp a detected tempo above the transport range down to 300', () => {
        const bpm = normalizeDetectedTempo(
            {
                points: [],
                averageBpm: 400,
                minBpm: 390,
                maxBpm: 410,
                confidence: 0.9,
                totalBeats: 16,
            },
            true
        );

        expect(bpm).toBe(300);
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should round and pass through a detected tempo already inside the transport range', () => {
        const bpm = normalizeDetectedTempo(
            {
                points: [],
                averageBpm: 90.4,
                minBpm: 85,
                maxBpm: 95,
                confidence: 0.9,
                totalBeats: 16,
            },
            true
        );

        expect(bpm).toBe(90);
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
