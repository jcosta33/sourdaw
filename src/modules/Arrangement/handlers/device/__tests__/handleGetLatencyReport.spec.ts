import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetLatencyReport } from '../handleGetLatencyReport';

const mocks = vi.hoisted(() => ({
    getLatencyReport: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getLatencyReport: mocks.getLatencyReport,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleGetLatencyReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes getLatencyReport and notifies user with track details', () => {
        mocks.getLatencyReport.mockReturnValue({
            maxLatencyMs: 15.5,
            contextBaseLatencyMs: 10.0,
            tracks: [
                { trackId: 't1', deviceLatencyMs: 5.5, totalLatencyMs: 15.5 }
            ],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: {} });

        expect(mocks.getLatencyReport).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Latency Report: Max: 15.5ms, Base: 10.0ms — t1: 15.5ms');
    });

    it('notifies user when no tracks have device latency', () => {
        mocks.getLatencyReport.mockReturnValue({
            maxLatencyMs: 10.0,
            contextBaseLatencyMs: 10.0,
            tracks: [
                { trackId: 't1', deviceLatencyMs: 0, totalLatencyMs: 10.0 }
            ],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: {} });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Latency Report: Max: 10.0ms, Base: 10.0ms — no device latency');
    });

    it('provides a description', () => {
        const desc = handleGetLatencyReport.describe({ type: 'getLatencyReport', payload: {} });
        expect(desc.label).toBe('Get latency report');
    });

    it('is not undoable', () => {
        expect(handleGetLatencyReport.undoable).toBe(false);
    });
});
