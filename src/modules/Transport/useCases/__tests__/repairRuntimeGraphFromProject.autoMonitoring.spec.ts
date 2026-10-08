import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stopInputMonitoring, syncAutoInputMonitoring } from '#/modules/AudioEngine/useCases';

import { defaultTransportState, transportStore } from '../../stores/transportStore';
import { repairRuntimeGraphFromProject } from '../repairRuntimeGraphFromProject';

import type { Store } from '#/infra/store/types';

type TestTrack = {
    id: string;
    kind: 'audio';
    armed: boolean;
    inputMonitoring: 'auto';
    inputId: string | null;
};

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
}));

const stores = vi.hoisted(() => ({
    trackStore: null as unknown as Store<{ tracks: TestTrack[] }>,
}));

// The owner, the re-arm and the capture repository run for real; the only
// replaced seams are the microphone request, the graph the repair rebuilds (its
// reset still releases every capture, as the real one does) and the schedulers
// it restarts.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        resetAudioGraph: vi.fn(() => {
            actual.stopInputMonitoring();
        }),
        stopAllScheduled: vi.fn(),
    };
});
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.trackStore = create<{ tracks: TestTrack[] }>();
    return {
        ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
        trackStore: stores.trackStore,
    };
});
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    resetExternalPluginRuntimeForGraphRebuild: vi.fn(() => Promise.resolve()),
}));
vi.mock('../ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(() => ({ status: 'ready', externalPluginActivations: [] })),
}));
vi.mock('../playheadScheduler/startPlayheadScheduler', () => ({ startPlayheadScheduler: vi.fn() }));
vi.mock('../playheadScheduler/stopPlayheadScheduler', () => ({ stopPlayheadScheduler: vi.fn() }));
vi.mock('../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));

const originalMediaDevices = globalThis.navigator.mediaDevices;

function armedAutoTrack(): TestTrack {
    return { id: 'track-1', kind: 'audio', armed: true, inputMonitoring: 'auto', inputId: 'input-1' };
}

describe('repairRuntimeGraphFromProject with an armed Auto audio track', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia: harness.getUserMedia },
            configurable: true,
        });
        stopInputMonitoring();
        harness.getUserMedia.mockReset();
        // A grant that never settles keeps the capture request in flight, which
        // is all the owner and the session need to treat the edge as held.
        harness.getUserMedia.mockImplementation(() => new Promise<MediaStream>(() => undefined));
        stores.trackStore.set({ tracks: [armedAutoTrack()] });
    });

    afterEach(() => {
        unsubscribe();
        stores.trackStore.set({ tracks: [] });
        transportStore.set(defaultTransportState);
        stopInputMonitoring();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('requests no microphone at any point while the transport is playing', async () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: false });
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).not.toHaveBeenCalled();

        await repairRuntimeGraphFromProject();

        expect(harness.getUserMedia).not.toHaveBeenCalled();
        expect(transportStore.value?.isPlaying).toBe(true);
    });

    it('requests the microphone exactly once more when the transport is stopped', async () => {
        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
        harness.getUserMedia.mockClear();

        await repairRuntimeGraphFromProject();

        expect(harness.getUserMedia).toHaveBeenCalledOnce();
    });
});
