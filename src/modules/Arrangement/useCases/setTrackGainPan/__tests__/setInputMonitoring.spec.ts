import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setInputMonitoring } from '../setInputMonitoring';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
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
        const call = mocks.updateTrack.mock.calls[0];
        if (!call) {
            throw new Error('expected updateTrack to be called');
        }
        const updater = call[1];
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

    it.each(['on', 'auto'] as const)(
        'rejects dormant VCA %s without writing or stopping another monitoring session',
        (mode) => {
            mocks.getTrackById.mockImplementation((trackId: string) => {
                if (trackId === 'audio-1') {
                    return { id: 'audio-1', kind: 'audio' };
                }
                return { id: 'vca-1', kind: 'vca' };
            });

            setInputMonitoring('audio-1', 'on');
            expect(mocks.startInputMonitoring).toHaveBeenCalledWith('audio-1');
            mocks.updateTrack.mockClear();
            mocks.startInputMonitoring.mockClear();

            setInputMonitoring('vca-1', mode);

            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
            expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
        }
    );

    it('normalizes dormant VCA residue only for an explicit off request without globally stopping monitoring', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca' });

        setInputMonitoring('vca-1', 'off');

        const call = mocks.updateTrack.mock.calls[0];
        if (!call) {
            throw new Error('expected dormant cleanup update');
        }
        expect(call[1]({ inputMonitoring: 'on' })).toEqual({ inputMonitoring: 'off' });
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });
});
vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));
