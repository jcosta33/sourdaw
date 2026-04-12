import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setInputMonitoring } from '../setInputMonitoring';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    startInputMonitoring: mocks.startInputMonitoring,
    stopInputMonitoring: mocks.stopInputMonitoring,
}));

describe('setInputMonitoring', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets monitoring to ON and starts it in engine', () => {
        setInputMonitoring('t1', 'on');
        
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ inputMonitoring: 'off' })).toEqual({ inputMonitoring: 'on' });

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1');
    });

    it('sets monitoring to OFF and stops it in engine', () => {
        setInputMonitoring('t1', 'off');
        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
    });

    it('sets monitoring to AUTO and stops it in engine', () => {
        setInputMonitoring('t1', 'auto');
        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
    });
});
