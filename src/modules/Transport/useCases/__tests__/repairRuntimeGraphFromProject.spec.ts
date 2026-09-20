import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { repairRuntimeGraphFromProject } from '../repairRuntimeGraphFromProject';

type MonitoredTrack = {
    id: string;
    inputMonitoring: 'on' | 'off' | 'auto';
    inputId: string | null;
    /** Only meaningful for `auto`; the re-arm must never consult it. */
    armed?: boolean;
};

const mocks = vi.hoisted(() => ({
    ensureTrackStrips: vi.fn(),
    forgetProjectLatchedPedals: vi.fn(),
    getTransportState: vi.fn(),
    panicYeastRuntime: vi.fn(() => Promise.resolve()),
    resetAudioGraph: vi.fn(),
    resetExternalPluginRuntimeForGraphRebuild: vi.fn(() => Promise.resolve()),
    resetMidiState: vi.fn(),
    startInputMonitoring: vi.fn(() => Promise.resolve(true)),
    startPlayheadScheduler: vi.fn(),
    stopAllScheduled: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
    trackStoreValue: { value: null as { tracks: MonitoredTrack[]; selectedTrackId: null } | null },
    updateTransportState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    forgetProjectLatchedPedals: mocks.forgetProjectLatchedPedals,
    resetAudioGraph: mocks.resetAudioGraph,
    startInputMonitoring: mocks.startInputMonitoring,
    stopAllScheduled: mocks.stopAllScheduled,
}));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        // The repair imports the Arrangement use-case barrel, whose transitive
        // graph registers a trackStore subscriber at module scope (Yeast). Keep
        // the real store's methods and override only the readable value.
        trackStore: {
            ...actual.trackStore,
            get value() {
                return mocks.trackStoreValue.value;
            },
        },
    };
});
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mocks.resetMidiState }));
vi.mock('#/modules/PluginHost/useCases', () => ({
    resetExternalPluginRuntimeForGraphRebuild: mocks.resetExternalPluginRuntimeForGraphRebuild,
}));
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

function monitoredTrack(
    id: string,
    inputMonitoring: MonitoredTrack['inputMonitoring'],
    inputId: string | null = null,
    armed = false
): MonitoredTrack {
    return { id, inputMonitoring, inputId, armed };
}

describe('repairRuntimeGraphFromProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playheadPositionRef.current = 8.5;
        mocks.getTransportState.mockReturnValue({ isPlaying: true, isRecording: false, playheadPosition: 4 });
        mocks.ensureTrackStrips.mockReturnValue({ status: 'ready', externalPluginActivations: [] });
        mocks.startInputMonitoring.mockReset();
        mocks.startInputMonitoring.mockResolvedValue(true);
        mocks.trackStoreValue.value = null;
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
        expect(mocks.resetExternalPluginRuntimeForGraphRebuild.mock.invocationCallOrder[0]).toBeLessThan(
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

    it('keeps the latched pedals, because a repair rebuilds the same project around the same foot', async () => {
        const repair = repairRuntimeGraphFromProject();
        await repair;

        // The pedal latch is forgotten only where a project is left. A repair
        // resets the graph mid-session and resumes playback in the same
        // project, so a damper still held has to reach the rebuilt bodies.
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.forgetProjectLatchedPedals).not.toHaveBeenCalled();
    });

    it('leaves playback coherently paused when a required plugin reattachment fails', async () => {
        mocks.ensureTrackStrips.mockReturnValue({
            status: 'ready',
            externalPluginActivations: [
                Promise.resolve({ status: 'failed', stage: 'attach', reason: 'compressor native reattachment failed' }),
            ],
        });

        await expect(repairRuntimeGraphFromProject()).rejects.toThrow(
            'Runtime graph repair failed: compressor native reattachment failed'
        );

        expect(mocks.resetExternalPluginRuntimeForGraphRebuild).toHaveBeenCalledOnce();
        expect(mocks.updateTransportState).toHaveBeenCalledOnce();
        expect(mocks.updateTransportState).toHaveBeenCalledWith({ isPlaying: false, playheadPosition: 8.5 });
        expect(mocks.startPlayheadScheduler).not.toHaveBeenCalled();
    });

    it('does not tear down the audio graph when external plugin teardown fails', async () => {
        mocks.resetExternalPluginRuntimeForGraphRebuild.mockRejectedValueOnce(new Error('native unload failed'));

        await expect(repairRuntimeGraphFromProject()).rejects.toThrow('native unload failed');

        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.ensureTrackStrips).not.toHaveBeenCalled();
        expect(mocks.startPlayheadScheduler).not.toHaveBeenCalled();
    });

    it('fails closed when transport runtime state is unavailable', async () => {
        mocks.getTransportState.mockReturnValue(null);

        await expect(repairRuntimeGraphFromProject()).rejects.toThrow(
            'Runtime graph repair requires initialized transport state'
        );

        expect(mocks.resetExternalPluginRuntimeForGraphRebuild).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
    });

    it('re-arms input monitoring for a track whose persisted intent is on, with its inputId', async () => {
        mocks.trackStoreValue.value = {
            tracks: [monitoredTrack('t1', 'on', 'in-1')],
            selectedTrackId: null,
        };

        await repairRuntimeGraphFromProject();

        // The reset released the capture and the rebuild produced a fresh
        // strip, so the musician's own signal has to be re-armed on that strip.
        expect(mocks.startInputMonitoring).toHaveBeenCalledOnce();
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'in-1');
    });

    it('does not re-arm tracks whose persisted intent is off or auto', async () => {
        mocks.trackStoreValue.value = {
            tracks: [
                monitoredTrack('t-off', 'off', 'in-off'),
                monitoredTrack('t-auto', 'auto', 'in-auto'),
                // `auto` is engine-driven by arm state and engages no monitor
                // here, so even an armed `auto` track must not re-arm.
                monitoredTrack('t-auto-armed', 'auto', 'in-auto-armed', true),
            ],
            selectedTrackId: null,
        };

        await repairRuntimeGraphFromProject();

        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('does not re-arm when the repair itself fails', async () => {
        mocks.trackStoreValue.value = {
            tracks: [monitoredTrack('t1', 'on', 'in-1')],
            selectedTrackId: null,
        };
        mocks.ensureTrackStrips.mockReturnValue({ status: 'failed', reason: 'strips unavailable' });

        await expect(repairRuntimeGraphFromProject()).rejects.toThrow(
            'Runtime graph repair failed: strips unavailable'
        );

        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('settles a re-arm that refuses without failing the repair', async () => {
        mocks.trackStoreValue.value = {
            tracks: [monitoredTrack('t1', 'on', 'in-1')],
            selectedTrackId: null,
        };
        mocks.startInputMonitoring.mockRejectedValueOnce(new Error('microphone refused'));

        await expect(repairRuntimeGraphFromProject()).resolves.toBeUndefined();

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'in-1');
    });
});
