import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pausePlayback } from '../pausePlayback';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';

vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('pausePlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should pause transport and tear down scheduling when state exists', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
    });

    it('should no-op when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(update).not.toHaveBeenCalled();
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
    });
});
