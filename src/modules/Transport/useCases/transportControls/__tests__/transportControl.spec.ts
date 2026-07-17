import { describe, it, expect, vi, beforeEach } from 'vitest';

import { seekPlayhead } from '../seekPlayhead';
import { stopPlayback } from '../stopPlayback';
import { togglePlayback } from '../togglePlayback';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    updateTransportState: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
    startPlayheadScheduler: vi.fn(),
    stopAllScheduled: vi.fn(),
    resetMidiState: vi.fn(),
    playheadPositionRef: { current: 0 },
    pausePlayback: vi.fn(),
    startPlayback: vi.fn(),
}));

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: mocks.updateTransportState,
}));

vi.mock('#/modules/Transport/stores/playheadPositionRef', () => ({
    playheadPositionRef: mocks.playheadPositionRef,
}));

vi.mock('#/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));
vi.mock('#/modules/Transport/useCases/playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: mocks.stopPlayheadScheduler,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    stopAllScheduled: mocks.stopAllScheduled,
    resetMidiState: mocks.resetMidiState,
}));

// Mock dynamic imports for togglePlayback
vi.mock('../pausePlayback', () => ({ pausePlayback: mocks.pausePlayback }));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));

describe('Transport Controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.playheadPositionRef.current = 0;
    });

    describe('togglePlayback', () => {
        it('calls startPlayback if not playing', async () => {
            mocks.getTransportState.mockReturnValue({ isPlaying: false });
            togglePlayback();
            await vi.waitFor(() => {
                expect(mocks.startPlayback).toHaveBeenCalled();
            });
        });

        it('calls pausePlayback if playing', async () => {
            mocks.getTransportState.mockReturnValue({ isPlaying: true });
            togglePlayback();
            await vi.waitFor(() => {
                expect(mocks.pausePlayback).toHaveBeenCalled();
            });
        });
    });

    describe('stopPlayback', () => {
        it('stops scheduler and resets playhead to 0 if no loop', () => {
            mocks.getTransportState.mockReturnValue({
                isPlaying: true,
                loopStart: 0,
                loopEnd: 0,
                playheadPosition: 10,
            });

            stopPlayback();

            expect(mocks.stopPlayheadScheduler).toHaveBeenCalled();
            expect(mocks.stopAllScheduled).toHaveBeenCalled();
            expect(mocks.updateTransportState).toHaveBeenCalledWith(
                expect.objectContaining({
                    isPlaying: false,
                    playheadPosition: 0,
                })
            );
            expect(mocks.playheadPositionRef.current).toBe(0);
        });

        it('resets playhead to loopStart if loop is active', () => {
            mocks.getTransportState.mockReturnValue({
                isPlaying: true,
                loopStart: 4,
                loopEnd: 8,
                playheadPosition: 6,
            });

            stopPlayback();

            expect(mocks.updateTransportState).toHaveBeenCalledWith(
                expect.objectContaining({
                    playheadPosition: 4,
                })
            );
        });
    });

    describe('seekPlayhead', () => {
        it('updates position and restarts scheduler if playing', () => {
            mocks.getTransportState.mockReturnValue({ isPlaying: true });

            seekPlayhead(16);

            expect(mocks.stopPlayheadScheduler).toHaveBeenCalled();
            expect(mocks.updateTransportState).toHaveBeenCalledWith({ playheadPosition: 16 });
            expect(mocks.playheadPositionRef.current).toBe(16);
            expect(mocks.startPlayheadScheduler).toHaveBeenCalled();
        });

        it('just updates position if not playing', () => {
            mocks.getTransportState.mockReturnValue({ isPlaying: false });

            seekPlayhead(32);

            expect(mocks.updateTransportState).toHaveBeenCalledWith({ playheadPosition: 32 });
            expect(mocks.stopPlayheadScheduler).not.toHaveBeenCalled();
        });
    });
});
