import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';
import { syncAutoInputMonitoring } from '../syncAutoInputMonitoring';

import type { Store } from '#/infra/store/types';

type InputMonitoring = 'auto' | 'on' | 'off';

type TestTrack = {
    id: string;
    name: string;
    kind: 'audio';
    armed: boolean;
    inputMonitoring: InputMonitoring;
    inputId: string | null;
};

type TestTransport = { isPlaying: boolean; isRecording: boolean };

type TestSource = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    createMediaStreamSource: vi.fn<(stream: MediaStream) => TestSource>(),
    ensureTrackStrip: vi.fn<(trackId: string) => { gainNode: unknown }>(),
    /** Every settlement of a use-case open, so the test can wait on the real promise the owner chains on. */
    opens: [] as Promise<boolean>[],
}));

// The real use cases and repository run; only the engine they feed is replaced.
vi.mock('../startInputMonitoring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../startInputMonitoring')>();
    return {
        startInputMonitoring: (trackId: string, inputId?: string | null): Promise<boolean> => {
            const open = actual.startInputMonitoring(trackId, inputId);
            harness.opens.push(open);
            return open;
        },
    };
});
vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { createMediaStreamSource: harness.createMediaStreamSource },
        ensureTrackStrip: harness.ensureTrackStrip,
    },
}));

const stores = vi.hoisted(() => ({
    trackStore: null as unknown as Store<{ tracks: TestTrack[] }>,
    transportStore: null as unknown as Store<TestTransport>,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.trackStore = create<{ tracks: TestTrack[] }>();
    return {
        ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
        trackStore: stores.trackStore,
    };
});

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.transportStore = create<TestTransport>();
    return {
        ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
        transportStore: stores.transportStore,
        defaultTransportState: { isPlaying: false, isRecording: false },
    };
});

const originalMediaDevices = globalThis.navigator.mediaDevices;
const GAIN_NODE = { name: 'strip-gain' };

function track(overrides: Partial<TestTrack> = {}): TestTrack {
    return {
        id: 'track-1',
        name: 'Audio',
        kind: 'audio',
        armed: true,
        inputMonitoring: 'auto',
        inputId: 'input-1',
        ...overrides,
    };
}

function setTrack(overrides: Partial<TestTrack> = {}): void {
    stores.trackStore.set({ tracks: [track(overrides)] });
}

function setTransport(state: TestTransport): void {
    stores.transportStore.set(state);
}

function deviceIdOfCall(index: number): unknown {
    const audio = harness.getUserMedia.mock.calls[index]?.[0]?.audio;
    return typeof audio === 'object' ? audio.deviceId : undefined;
}

/** Every open started so far has settled, and the owner has recorded its outcome. */
async function settleOpens(): Promise<void> {
    await Promise.all(harness.opens);
}

describe('reconcileAutoInputMonitoring refusal memory', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia: harness.getUserMedia },
            configurable: true,
        });
        stopInputMonitoring();
        harness.opens.length = 0;
        harness.getUserMedia.mockReset();
        harness.createMediaStreamSource.mockReset();
        harness.ensureTrackStrip.mockReset();
        harness.ensureTrackStrip.mockReturnValue({ gainNode: GAIN_NODE });
        stores.trackStore.set({ tracks: [] });
        setTransport({ isPlaying: false, isRecording: false });
        reconcileAutoInputMonitoring();
    });

    afterEach(() => {
        unsubscribe();
        stopInputMonitoring();
        stores.trackStore.set({ tracks: [] });
        reconcileAutoInputMonitoring();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('does not lose a pending open when unrelated track publications arrive before it is refused', async () => {
        let refuseGrant!: (error: Error) => void;
        harness.getUserMedia.mockReturnValueOnce(
            new Promise<MediaStream>((_resolve, reject) => {
                refuseGrant = reject;
            })
        );
        harness.getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
        setTrack();
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        setTrack({ name: 'Renamed while the grant is pending' });
        refuseGrant(new Error('NotAllowedError'));
        await settleOpens();
        setTrack({ name: 'Renamed after the refusal' });

        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('retries a refused open once when Record starts from stop, and not on later publications', async () => {
        harness.getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
        setTrack();
        unsubscribe = syncAutoInputMonitoring();
        await settleOpens();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        setTransport({ isPlaying: false, isRecording: true });
        await settleOpens();
        setTransport({ isPlaying: true, isRecording: true });
        await settleOpens();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);

        setTransport({ isPlaying: true, isRecording: true });
        await settleOpens();
        setTrack({ name: 'Renamed while recording' });
        await settleOpens();
        setTransport({ isPlaying: true, isRecording: true });
        await settleOpens();

        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
    });

    it('still releases an edge held through On after a recording starts and the transport rests', async () => {
        const source: TestSource = { connect: vi.fn(), disconnect: vi.fn() };
        harness.createMediaStreamSource.mockReturnValue(source);
        const stopStreamTrack = vi.fn();
        harness.getUserMedia.mockResolvedValue({
            getTracks: () => [{ stop: stopStreamTrack }],
        } as unknown as MediaStream);
        setTrack();
        unsubscribe = syncAutoInputMonitoring();
        await settleOpens();
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);

        setTrack({ inputMonitoring: 'on' });
        setTransport({ isPlaying: true, isRecording: true });
        setTransport({ isPlaying: false, isRecording: false });
        setTrack({ inputMonitoring: 'off' });

        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(stopStreamTrack).toHaveBeenCalledTimes(1);
    });

    it('opens the new input when the input changes after a refusal on the old one', async () => {
        harness.getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
        setTrack({ inputId: 'input-x' });
        unsubscribe = syncAutoInputMonitoring();
        await settleOpens();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        expect(deviceIdOfCall(0)).toEqual({ exact: 'input-x' });

        setTrack({ inputId: 'input-y' });

        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
        expect(deviceIdOfCall(1)).toEqual({ exact: 'input-y' });
    });
});
