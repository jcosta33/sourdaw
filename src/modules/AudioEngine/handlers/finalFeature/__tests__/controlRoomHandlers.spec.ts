import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { switchMonitor } from '../../../useCases/controlRoom/switchMonitor';
import { toggleDim } from '../../../useCases/controlRoom/toggleDim';
import { toggleMono } from '../../../useCases/controlRoom/toggleMono';
import { getLatencyReport } from '../../../useCases/latencyCompensation/compensation/getLatencyReport';
import { setMasterGain } from '../../../useCases/setMasterGain';
import { setMpeEnabled } from '../../../useCases/webMidiInput/setMpeEnabled';
import { handleDisableMpe } from '../handleDisableMpe';
import { handleEnableMpe } from '../handleEnableMpe';
import { handleGetLatencyReport } from '../handleGetLatencyReport';
import { handleSetMasterGain } from '../handleSetMasterGain';
import { handleSwitchMonitor } from '../handleSwitchMonitor';
import { handleToggleControlRoomDim } from '../handleToggleControlRoomDim';
import { handleToggleControlRoomMono } from '../handleToggleControlRoomMono';

vi.mock('../../../useCases/controlRoom/switchMonitor', () => ({ switchMonitor: vi.fn() }));
vi.mock('../../../useCases/controlRoom/toggleDim', () => ({ toggleDim: vi.fn() }));
vi.mock('../../../useCases/controlRoom/toggleMono', () => ({ toggleMono: vi.fn() }));
vi.mock('../../../useCases/latencyCompensation/compensation/getLatencyReport', () => ({ getLatencyReport: vi.fn() }));
vi.mock('../../../useCases/setMasterGain', () => ({ setMasterGain: vi.fn() }));
vi.mock('../../../useCases/webMidiInput/setMpeEnabled', () => ({ setMpeEnabled: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('controlRoomHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should switch monitor output', () => {
        handleSwitchMonitor.execute({ type: 'switchMonitor', payload: { monitorId: 'mon-1' } });

        expect(switchMonitor).toHaveBeenCalledWith('mon-1');
    });

    it('should toggle dim monitoring', () => {
        handleToggleControlRoomDim.execute({ type: 'toggleControlRoomDim', payload: {} });

        expect(toggleDim).toHaveBeenCalledTimes(1);
    });

    it('should toggle mono monitoring', () => {
        handleToggleControlRoomMono.execute({ type: 'toggleControlRoomMono', payload: {} });

        expect(toggleMono).toHaveBeenCalledTimes(1);
    });

    it('should enable MPE input handling', () => {
        handleEnableMpe.execute({ type: 'enableMpe', payload: {} });

        expect(setMpeEnabled).toHaveBeenCalledWith(true);
    });

    it('should disable MPE input handling', () => {
        handleDisableMpe.execute({ type: 'disableMpe', payload: {} });

        expect(setMpeEnabled).toHaveBeenCalledWith(false);
    });

    it('should notify with latency report details', () => {
        vi.mocked(getLatencyReport).mockReturnValue({
            maxLatencyMs: 15.5,
            contextBaseLatencyMs: 10,
            tracks: [{ trackId: 't1', deviceLatencyMs: 5.5, totalLatencyMs: 15.5 }],
        });

        handleGetLatencyReport.execute({ type: 'getLatencyReport', payload: {} });

        expect(notifyUser).toHaveBeenCalledWith('Latency Report: Max: 15.5ms, Base: 10.0ms — t1: 15.5ms');
    });

    it('should set normalized master gain', () => {
        handleSetMasterGain.execute({ type: 'setMasterGain', payload: { gain: 0.8 } });

        expect(setMasterGain).toHaveBeenCalledWith(0.8);
    });
});
