import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addCvOutput } from '#/modules/CvGate/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getLatencyReport } from '../../../useCases/latencyCompensation/compensation/getLatencyReport';
import { setMasterGain } from '../../../useCases/setMasterGain';
import { setMpeEnabled } from '../../../useCases/webMidiInput/setMpeEnabled';
import { handleAddCvOutput } from '../handleAddCvOutput';
import { handleDisableMpe } from '../handleDisableMpe';
import { handleEnableMpe } from '../handleEnableMpe';
import { handleGetLatencyReport } from '../handleGetLatencyReport';
import { handleSetMasterGain } from '../handleSetMasterGain';

vi.mock('#/modules/CvGate/useCases', () => ({ addCvOutput: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Project/useCases', () => ({
    exportDawProject: vi.fn(async () => ({ bytes: new Uint8Array([0]), fileName: 'demo.dawproject' })),
}));
vi.mock('../../../useCases/latencyCompensation/compensation/getLatencyReport', () => ({ getLatencyReport: vi.fn() }));
vi.mock('../../../useCases/setMasterGain', () => ({ setMasterGain: vi.fn() }));
vi.mock('../../../useCases/webMidiInput/setMpeEnabled', () => ({ setMpeEnabled: vi.fn() }));

describe('finalFeatureMiscHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleAddCvOutput should delegate to addCvOutput', () => {
        void handleAddCvOutput.execute({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 0, type: 'gate' } });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 1', 0, 'gate');
    });

    it('should enable MPE input handling', () => {
        handleEnableMpe.execute({ type: 'enableMpe', payload: undefined });

        expect(setMpeEnabled).toHaveBeenCalledWith(true);
    });

    it('should disable MPE input handling', () => {
        handleDisableMpe.execute({ type: 'disableMpe', payload: undefined });

        expect(setMpeEnabled).toHaveBeenCalledWith(false);
    });

    it('should notify with latency report details', () => {
        vi.mocked(getLatencyReport).mockReturnValue({
            maxLatencyMs: 15.5,
            contextBaseLatencyMs: 10,
            contextOutputLatencyMs: 0,
            tracks: [{ trackId: 't1', deviceLatencyMs: 5.5, totalLatencyMs: 15.5 }],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: undefined });

        expect(notifyUser).toHaveBeenCalledWith('Latency Report: Max: 15.5ms, Base: 10.0ms — t1: 15.5ms');
    });

    it('should set normalized master gain', () => {
        handleSetMasterGain.execute({ type: 'setMasterGain', payload: { gain: 0.8 } });

        expect(setMasterGain).toHaveBeenCalledWith(0.8);
    });
});
