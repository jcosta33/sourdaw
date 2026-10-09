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

type Gate = { open: () => void };

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    resetPlugins: vi.fn<() => Promise<void>>(),
    ensureTrackStrips:
        vi.fn<() => { status: 'ready'; externalPluginActivations: [] } | { status: 'failed'; reason: string }>(),
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
    resetExternalPluginRuntimeForGraphRebuild: harness.resetPlugins,
}));
vi.mock('../ensureTrackStrips', () => ({ ensureTrackStrips: harness.ensureTrackStrips }));
vi.mock('../playheadScheduler/startPlayheadScheduler', () => ({ startPlayheadScheduler: vi.fn() }));
vi.mock('../playheadScheduler/stopPlayheadScheduler', () => ({ stopPlayheadScheduler: vi.fn() }));
vi.mock('../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));

const originalMediaDevices = globalThis.navigator.mediaDevices;

function armedAutoTrack(): TestTrack {
    return { id: 'track-1', kind: 'audio', armed: true, inputMonitoring: 'auto', inputId: 'input-1' };
}

/** Makes the next repair wait at its plugin reset, the first awaited step of a stopped repair. */
function holdNextRepairAtPluginReset(): Gate {
    let open!: () => void;
    harness.resetPlugins.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                open = resolve;
            })
    );
    return { open: () => open() };
}

/** Lets every settlement already queued run, which is when the owner learns an open's outcome. */
function drainSettledOpens(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function setTransport(isPlaying: boolean): void {
    transportStore.set({ ...defaultTransportState, isPlaying, isRecording: false });
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
        harness.resetPlugins.mockReset();
        harness.resetPlugins.mockImplementation(() => Promise.resolve());
        harness.ensureTrackStrips.mockReset();
        harness.ensureTrackStrips.mockReturnValue({ status: 'ready', externalPluginActivations: [] });
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
        setTransport(true);
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).not.toHaveBeenCalled();

        await repairRuntimeGraphFromProject();

        expect(harness.getUserMedia).not.toHaveBeenCalled();
        expect(transportStore.value?.isPlaying).toBe(true);
    });

    it('requests the microphone exactly once more when the transport is stopped', async () => {
        setTransport(false);
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
        harness.getUserMedia.mockClear();

        await repairRuntimeGraphFromProject();

        expect(harness.getUserMedia).toHaveBeenCalledOnce();
    });

    it('closes the edge at once when Play is pressed during a repair that began stopped', async () => {
        const stopTrack = vi.fn();
        let grant!: (stream: MediaStream) => void;
        harness.getUserMedia.mockImplementationOnce(
            () =>
                new Promise<MediaStream>((resolve) => {
                    grant = resolve;
                })
        );
        setTransport(false);
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
        const gate = holdNextRepairAtPluginReset();
        const repair = repairRuntimeGraphFromProject();

        setTransport(true);
        // With the edge closed the capture has no interested track left, so the
        // late grant is released instead of being connected to a strip.
        grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
        await vi.waitFor(() => {
            expect(stopTrack).toHaveBeenCalledOnce();
        });

        gate.open();
        await repair;
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
    });

    it('retries a refused input once after a hold in which Play and Stop were pressed', async () => {
        harness.getUserMedia.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
        setTransport(false);
        unsubscribe = syncAutoInputMonitoring();
        await drainSettledOpens();
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
        harness.getUserMedia.mockClear();
        const gate = holdNextRepairAtPluginReset();
        const repair = repairRuntimeGraphFromProject();

        setTransport(true);
        setTransport(false);
        expect(harness.getUserMedia).not.toHaveBeenCalled();

        gate.open();
        await repair;
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
    });

    it('settles monitoring when the rebuild throws', async () => {
        stores.trackStore.set({ tracks: [] });
        setTransport(false);
        unsubscribe = syncAutoInputMonitoring();
        harness.ensureTrackStrips.mockReturnValue({ status: 'failed', reason: 'strips unavailable' });
        const gate = holdNextRepairAtPluginReset();
        const repair = repairRuntimeGraphFromProject();
        const rejection = expect(repair).rejects.toThrow('Runtime graph repair failed: strips unavailable');

        stores.trackStore.set({ tracks: [armedAutoTrack()] });
        expect(harness.getUserMedia).not.toHaveBeenCalled();

        gate.open();
        await rejection;
        expect(harness.getUserMedia).toHaveBeenCalledOnce();
    });
});
