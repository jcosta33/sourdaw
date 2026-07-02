import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { stopPlayheadScheduler } from '../../playheadScheduler';
import { pausePlayback } from '../pausePlayback';
import { stopActiveRecording } from '../stopActiveRecording';

vi.mock('../../playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('pausePlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopActiveRecording).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should pause transport and tear down scheduling when state exists', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
    });

    it('should flip isPlaying:false before stopping the scheduler so an in-flight tick bails', () => {
        const order: string[] = [];
        const update = vi.fn<typeof updateTransportState>().mockImplementation((patch) => {
            if (patch.isPlaying === false) {
                order.push('isPlaying:false');
            }
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        // The paused state must be committed before the worker is terminated:
        // a queued tick reads transportStore.isPlaying first and must see false.
        expect(order[0]).toBe('isPlaying:false');
        expect(order).toContain('stopPlayheadScheduler');
        expect(order.indexOf('isPlaying:false')).toBeLessThan(order.indexOf('stopPlayheadScheduler'));
    });

    it('should cancel a pending count-in via stopActiveRecording even when not recording', () => {
        const update = vi.fn<typeof updateTransportState>();
        // During count-in isRecording is still false; the count-in timer must
        // still be cleared so it cannot fire beginActualRecording after pause.
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
    });

    it('should no-op when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(update).not.toHaveBeenCalled();
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(stopActiveRecording).not.toHaveBeenCalled();
    });
});
