import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addCvOutput } from '#/modules/CvGate/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getLatencyReport } from '../../../useCases/latencyCompensation/compensation/getLatencyReport';
import { handleAddCvOutput } from '../handleAddCvOutput';
import { handleGetLatencyReport } from '../handleGetLatencyReport';

vi.mock('#/modules/CvGate/useCases', () => ({ addCvOutput: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Project/useCases', () => ({
    exportDawProject: vi.fn(async () => ({ bytes: new Uint8Array([0]), fileName: 'demo.dawproject' })),
}));
vi.mock('../../../useCases/latencyCompensation/compensation/getLatencyReport', () => ({ getLatencyReport: vi.fn() }));

describe('finalFeatureMiscHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleAddCvOutput should delegate to addCvOutput', () => {
        void handleAddCvOutput.execute({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 0, type: 'gate' } });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 1', 0, 'gate');
    });

    it('should notify with latency report details', () => {
        vi.mocked(getLatencyReport).mockReturnValue({
            maxLatencyMs: 15.5,
            contextBaseLatencyMs: 10,
            contextOutputLatencyMs: 11.7,
            tracks: [{ trackId: 't1', deviceLatencyMs: 5.5, totalLatencyMs: 15.5 }],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: undefined });

        expect(notifyUser).toHaveBeenCalledWith(
            'Latency Report: Max: 15.5ms, Output: 21.7ms (context 10.0ms + device 11.7ms) — t1: 15.5ms'
        );
    });

    // `getLatencyReport` has always computed `contextOutputLatencyMs`; the notification
    // dropped it, so the reported figure was short by the whole device buffer. Context
    // and device terms are kept different and non-zero so "context only" (10.0ms),
    // "device only" (11.7ms) and the sum (21.7ms) are three distinguishable readouts.
    it('reports the summed output latency when there is no device latency to list', () => {
        vi.mocked(getLatencyReport).mockReturnValue({
            maxLatencyMs: 0,
            contextBaseLatencyMs: 5.3,
            contextOutputLatencyMs: 10.7,
            tracks: [{ trackId: 't1', deviceLatencyMs: 0, totalLatencyMs: 0 }],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: undefined });

        expect(notifyUser).toHaveBeenCalledWith(
            'Latency Report: Max: 0.0ms, Output: 16.0ms (context 5.3ms + device 10.7ms) — no device latency'
        );
    });
});
