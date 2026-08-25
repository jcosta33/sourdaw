import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { repairRuntimeGraphFromProject } from '../repairRuntimeGraphFromProject';

const mocks = vi.hoisted(() => ({
    ensureTrackStrips: vi.fn(),
    getTransportState: vi.fn(),
    panicYeastRuntime: vi.fn(() => Promise.resolve()),
    resetAudioGraph: vi.fn(),
    resetMidiState: vi.fn(),
    startPlayheadScheduler: vi.fn(),
    stopAllScheduled: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
    updateTransportState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: mocks.resetAudioGraph,
    stopAllScheduled: mocks.stopAllScheduled,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mocks.resetMidiState }));
vi.mock('../../repositories/transport/getTransportState', () => ({
    getTransportState: mocks.getTransportState,
}));
vi.mock('../../repositories/transport/updateTransportState', () => ({
    updateTransportState: mocks.updateTransportState,
}));
vi.mock('../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));
vi.mock('../playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: mocks.stopPlayheadScheduler,
}));
vi.mock('../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: mocks.panicYeastRuntime }));

describe('repairRuntimeGraphFromProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playheadPositionRef.current = 8.5;
        mocks.getTransportState.mockReturnValue({ isPlaying: true, isRecording: false, playheadPosition: 4 });
        mocks.ensureTrackStrips.mockReturnValue({ status: 'ready', externalPluginActivations: [] });
    });

    it('pauses, rebuilds, awaits plugins, and reschedules from the live playhead', async () => {
        let settlePlugin!: (value: { status: 'active' }) => void;
        const pluginActivation = new Promise<{ status: 'active' }>((resolve) => {
            settlePlugin = resolve;
        });
        mocks.ensureTrackStrips.mockReturnValue({
            status: 'ready',
            externalPluginActivations: [pluginActivation],
        });

        const repair = repairRuntimeGraphFromProject();
        await vi.waitFor(() => expect(mocks.resetAudioGraph).toHaveBeenCalledOnce());

        expect(mocks.updateTransportState).toHaveBeenNthCalledWith(1, {
            isPlaying: false,
            playheadPosition: 8.5,
        });
        expect(mocks.stopPlayheadScheduler.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.resetAudioGraph.mock.invocationCallOrder[0]!
        );
        expect(mocks.stopAllScheduled.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.resetAudioGraph.mock.invocationCallOrder[0]!
        );
        expect(mocks.ensureTrackStrips).toHaveBeenCalledWith({ collectExternalPluginActivations: true });
        expect(mocks.startPlayheadScheduler).not.toHaveBeenCalled();

        settlePlugin({ status: 'active' });
        await repair;

        expect(mocks.updateTransportState).toHaveBeenNthCalledWith(2, {
            isPlaying: true,
            playheadPosition: 8.5,
        });
        expect(mocks.startPlayheadScheduler).toHaveBeenCalledOnce();
        expect(playheadPositionRef.current).toBe(8.5);
    });

    it('leaves playback coherently paused when a required plugin remains unsettled', async () => {
        mocks.ensureTrackStrips.mockReturnValue({
            status: 'ready',
            externalPluginActivations: [
                Promise.resolve({ status: 'failed', reason: 'compressor state restore failed' }),
            ],
        });

        await expect(repairRuntimeGraphFromProject()).rejects.toThrow(
            'Runtime graph repair failed: compressor state restore failed'
        );

        expect(mocks.updateTransportState).toHaveBeenCalledOnce();
        expect(mocks.updateTransportState).toHaveBeenCalledWith({ isPlaying: false, playheadPosition: 8.5 });
        expect(mocks.startPlayheadScheduler).not.toHaveBeenCalled();
    });
});
