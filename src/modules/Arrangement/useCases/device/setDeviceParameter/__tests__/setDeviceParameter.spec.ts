import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setDeviceParameter } from '../setDeviceParameter';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    getTransportState: vi.fn(),
    updateDeviceParam: vi.fn(),
    recordAutomationValue: vi.fn(),
}));

vi.mock('../../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    recordAutomationValue: mocks.recordAutomationValue,
}));

describe('setDeviceParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ isPlaying: false });
    });

    it('updates parameter in store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', parameterValues: { gain: 0.1 } }] }],
        });

        setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const updater = mocks.updateTrack.mock.calls[0][1];
        const result = updater({ devices: [{ id: 'd1', parameterValues: { gain: 0.1 } }] });
        expect(result.devices[0].parameterValues.gain).toBe(0.5);
    });

    it('records automation if playing and recording mode', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'write', devices: [{ id: 'd1' }] }],
        });
        mocks.getTransportState.mockReturnValue({ isPlaying: true, playheadPosition: 8 });

        setDeviceParameter('d1', 'cutoff', 1000);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'd1:cutoff', 1000, 8);
    });

    it('bails if value is not finite', () => {
        setDeviceParameter('d1', 'gain', NaN);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });
});
