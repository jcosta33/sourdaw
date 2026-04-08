import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { pausePlayback } from './pausePlayback';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput';

vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput', () => ({
    resetMidiState: vi.fn(),
}));

describe('pausePlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
    });

    it('should pause transport and tear down scheduling when state exists', () => {
        const update = vi.fn();
        injectDependencies(pausePlayback, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, isPlaying: true })),
            updateTransportState: update,
        });

        pausePlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
    });

    it('should no-op when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(pausePlayback, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        pausePlayback();

        expect(update).not.toHaveBeenCalled();
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
    });
});
