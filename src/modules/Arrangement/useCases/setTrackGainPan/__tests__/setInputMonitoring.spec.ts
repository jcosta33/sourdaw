import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { setInputMonitoring } from '../setInputMonitoring';

const inputTwoTrack = {
    id: 't1',
    kind: 'audio',
    inputId: 'input-2',
} satisfies Pick<Track, 'id' | 'kind' | 'inputId'>;

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    startInputMonitoring: mocks.startInputMonitoring,
    stopInputMonitoring: mocks.stopInputMonitoring,
    stopTrackInputMonitoring: mocks.stopTrackInputMonitoring,
}));

describe('setInputMonitoring', () => {
    beforeEach(() => vi.resetAllMocks());

    it('sets monitoring to ON and starts it in engine', () => {
        setInputMonitoring('t1', 'on');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const call = mocks.updateTrack.mock.calls[0];
        if (!call) {
            throw new Error('expected updateTrack to be called');
        }
        const updater = call[1];
        expect(updater({ inputMonitoring: 'off' })).toEqual({ inputMonitoring: 'on' });

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', undefined);
    });

    it('starts monitoring on the track’s own selected input', () => {
        mocks.getTrackById.mockReturnValue(inputTwoTrack);

        setInputMonitoring('t1', 'on');

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'input-2');
    });

    it('starts monitoring on the default capture when the track has no explicit selection', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', inputId: null });

        setInputMonitoring('t1', 'on');

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', null);
    });

    it('sets monitoring to OFF and stops that track’s listening edge only', () => {
        setInputMonitoring('t1', 'off');

        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('sets monitoring to AUTO and stops that track’s listening edge only', () => {
        setInputMonitoring('t1', 'auto');

        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it.each(['on', 'auto'] as const)(
        'rejects dormant VCA %s without writing or stopping another monitoring session',
        (mode) => {
            mocks.getTrackById.mockImplementation((trackId: string) => {
                if (trackId === 'audio-1') {
                    return { id: 'audio-1', kind: 'audio', inputId: 'input-2' };
                }
                return { id: 'vca-1', kind: 'vca' };
            });

            setInputMonitoring('audio-1', 'on');
            expect(mocks.startInputMonitoring).toHaveBeenCalledWith('audio-1', 'input-2');
            mocks.updateTrack.mockClear();
            mocks.startInputMonitoring.mockClear();

            setInputMonitoring('vca-1', mode);

            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
            expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
        }
    );

    it('normalizes dormant VCA residue only for an explicit off request without stopping any listening edge', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca' });

        setInputMonitoring('vca-1', 'off');

        const call = mocks.updateTrack.mock.calls[0];
        if (!call) {
            throw new Error('expected dormant cleanup update');
        }
        expect(call[1]({ inputMonitoring: 'on' })).toEqual({ inputMonitoring: 'off' });
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
    });
});
vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));
