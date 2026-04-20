import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTrackPan } from '../setTrackPan';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    engineSetTrackPan: vi.fn(),
    updateDeviceParam: vi.fn(),
    getAllTracks: vi.fn(),
    getTransportState: vi.fn(),
    getTrackById: vi.fn(),
    recordAutomationValue: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setTrackPan: mocks.engineSetTrackPan,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/useCases/getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    recordAutomationValue: mocks.recordAutomationValue,
}));

describe('setTrackPan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getTransportState.mockReturnValue({ isPlaying: false });
    });

    it('updates track pan and notifies engine', () => {
        setTrackPan('t1', 25);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ pan: 0 })).toEqual({ pan: 25 });

        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', 25);
    });

    it('clamps pan between -50 and 50', () => {
        setTrackPan('t1', 60);
        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', 50);

        setTrackPan('t1', -100);
        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', -50);
    });

    it('records automation if track automation mode is write/touch', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.getTransportState.mockReturnValue({ isPlaying: true, playheadPosition: 10 });

        setTrackPan('t1', -10);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'pan', -10, 10);
    });
});
