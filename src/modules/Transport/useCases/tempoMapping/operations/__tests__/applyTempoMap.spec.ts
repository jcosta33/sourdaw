import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../../models/TransportState';
import { getTransportState } from '../../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../../repositories/transport/updateTransportState';
import { applyTempoMap } from '../applyTempoMap';

vi.mock('../../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

vi.mock('../../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('applyTempoMap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not update when transport state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        applyTempoMap({
            points: [],
            averageBpm: 128,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should set tempo from average BPM when positive', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 128.4,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 128 });
    });

    it('should not update when average BPM is zero', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 0,
            minBpm: 0,
            maxBpm: 0,
            confidence: 0,
            totalBeats: 0,
        });

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should clamp a detected tempo above the transport range down to 300', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 400,
            minBpm: 390,
            maxBpm: 410,
            confidence: 0.9,
            totalBeats: 16,
        });

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 300 });
    });

    it('should round and pass through a detected tempo already inside the transport range', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 90.4,
            minBpm: 85,
            maxBpm: 95,
            confidence: 0.9,
            totalBeats: 16,
        });

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 90 });
    });
});
