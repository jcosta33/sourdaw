import { afterEach, describe, expect, it, vi } from 'vitest';

type AudioBufferSlice = Pick<AudioBuffer, 'getChannelData' | 'length' | 'numberOfChannels' | 'sampleRate'>;

type DecodePlan =
    { kind: 'resolve'; audioBuffer: AudioBufferSlice } | { kind: 'manual' } | { kind: 'reject'; error: unknown };

type DecodeRequest = {
    arrayBuffer: ArrayBuffer;
    resolve: (audioBuffer: AudioBufferSlice) => void;
    reject: (error: unknown) => void;
};

type FetchReply = {
    ok: boolean;
    status: number;
    body?: ArrayBuffer;
};

const decodePlans: DecodePlan[] = [];
const decodeRequests: DecodeRequest[] = [];
const offlineContexts: TestOfflineAudioContext[] = [];

class TestOfflineAudioContext {
    public readonly numberOfChannels: number;
    public readonly length: number;
    public readonly sampleRate: number;

    public constructor(numberOfChannels: number, length: number, sampleRate: number) {
        this.numberOfChannels = numberOfChannels;
        this.length = length;
        this.sampleRate = sampleRate;
        offlineContexts.push(this);
    }

    public decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBufferSlice> {
        const plan = decodePlans.shift();
        if (!plan) {
            return Promise.reject(new Error('Unexpected decodeAudioData call'));
        }
        if (plan.kind === 'resolve') {
            return Promise.resolve(plan.audioBuffer);
        }
        if (plan.kind === 'reject') {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Simulates browser decodeAudioData rejecting with a non-Error value.
            return Promise.reject(plan.error);
        }

        return new Promise((resolve, reject) => {
            decodeRequests.push({ arrayBuffer, resolve, reject });
        });
    }
}

function installOfflineAudioContext(): void {
    vi.stubGlobal('OfflineAudioContext', TestOfflineAudioContext);
}

function makeAudioBuffer({
    channels,
    sampleRate = 48_000,
}: {
    channels: Array<Float32Array<ArrayBuffer>>;
    sampleRate?: number;
}): AudioBufferSlice {
    const firstChannel = channels[0];
    if (!firstChannel) {
        throw new Error('makeAudioBuffer requires at least one channel');
    }

    return {
        numberOfChannels: channels.length,
        length: firstChannel.length,
        sampleRate,
        getChannelData(channelIndex: number): Float32Array<ArrayBuffer> {
            const channel = channels[channelIndex];
            if (!channel) {
                throw new Error(`Missing channel ${channelIndex}`);
            }
            return channel;
        },
    };
}

function stubFetch({ replies }: { replies: FetchReply[] }): ReturnType<typeof vi.fn> {
    const queuedReplies = [...replies];
    const fetchMock = vi.fn(() => {
        const reply = queuedReplies.shift();
        if (!reply) {
            throw new Error('Unexpected fetch call');
        }

        return {
            ok: reply.ok,
            status: reply.status,
            arrayBuffer: () => Promise.resolve(reply.body ?? new ArrayBuffer(0)),
        };
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function importSubject(): Promise<typeof import('../fetchAndDecode')> {
    return import('../fetchAndDecode');
}

async function waitForDecodeRequestCount({ count }: { count: number }): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (decodeRequests.length >= count) {
            return;
        }
        await Promise.resolve();
    }
    throw new Error(`Expected ${count} decode request(s), received ${decodeRequests.length}`);
}

function getDecodeRequest({ index }: { index: number }): DecodeRequest {
    const request = decodeRequests[index];
    if (!request) {
        throw new Error(`Missing decode request ${index}`);
    }
    return request;
}

describe('fetchAndDecode', () => {
    afterEach(() => {
        decodePlans.length = 0;
        decodeRequests.length = 0;
        offlineContexts.length = 0;
        vi.resetModules();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('should throw the sample URL and status when fetch fails', async () => {
        installOfflineAudioContext();
        stubFetch({ replies: [{ ok: false, status: 404 }] });
        const { fetchAndDecode } = await importSubject();

        await expect(fetchAndDecode('/samples/missing.wav')).rejects.toThrow(
            'Failed to fetch sample: /samples/missing.wav (404)'
        );

        expect(offlineContexts).toHaveLength(0);
    });

    it('should interleave decoded channel PCM into a Float32Array', async () => {
        installOfflineAudioContext();
        stubFetch({ replies: [{ ok: true, status: 200, body: new ArrayBuffer(8) }] });
        decodePlans.push({
            kind: 'resolve',
            audioBuffer: makeAudioBuffer({
                channels: [new Float32Array([1, 2, 3]), new Float32Array([10, 20, 30])],
            }),
        });
        const { fetchAndDecode } = await importSubject();

        const decoded = await fetchAndDecode('/samples/stereo.wav');

        expect(Array.from(decoded.data)).toEqual([1, 10, 2, 20, 3, 30]);
        expect(decoded.data.buffer).toBeInstanceOf(SharedArrayBuffer);
        expect(decoded.frameCount).toBe(3);
        expect(decoded.channels).toBe(2);
        expect(decoded.sampleRate).toBe(48_000);
    });

    it('should reuse one shared OfflineAudioContext across decodes', async () => {
        installOfflineAudioContext();
        stubFetch({
            replies: [
                { ok: true, status: 200, body: new ArrayBuffer(4) },
                { ok: true, status: 200, body: new ArrayBuffer(4) },
            ],
        });
        decodePlans.push(
            { kind: 'resolve', audioBuffer: makeAudioBuffer({ channels: [new Float32Array([1])] }) },
            { kind: 'resolve', audioBuffer: makeAudioBuffer({ channels: [new Float32Array([2])] }) }
        );
        const { fetchAndDecode } = await importSubject();

        await fetchAndDecode('/samples/one.wav');
        await fetchAndDecode('/samples/two.wav');

        expect(offlineContexts).toHaveLength(1);
        expect(offlineContexts[0]).toMatchObject({ numberOfChannels: 2, length: 44_100, sampleRate: 44_100 });
    });

    it('allows the bank resource to run bounded Chrome decodes concurrently', async () => {
        installOfflineAudioContext();
        stubFetch({
            replies: [
                { ok: true, status: 200, body: new ArrayBuffer(4) },
                { ok: true, status: 200, body: new ArrayBuffer(4) },
            ],
        });
        decodePlans.push({ kind: 'manual' }, { kind: 'manual' });
        const { fetchAndDecode } = await importSubject();

        const firstDecode = fetchAndDecode('/samples/one.wav');
        const secondDecode = fetchAndDecode('/samples/two.wav');

        await waitForDecodeRequestCount({ count: 2 });
        expect(decodeRequests).toHaveLength(2);

        getDecodeRequest({ index: 0 }).resolve(makeAudioBuffer({ channels: [new Float32Array([1])] }));
        getDecodeRequest({ index: 1 }).resolve(makeAudioBuffer({ channels: [new Float32Array([2])] }));
        await expect(firstDecode).resolves.toMatchObject({ frameCount: 1, channels: 1, sampleRate: 48_000 });
        await expect(secondDecode).resolves.toMatchObject({ frameCount: 1, channels: 1, sampleRate: 48_000 });
    });

    it('does not allocate or interleave stale PCM after a pending Chrome decode is aborted', async () => {
        installOfflineAudioContext();
        stubFetch({ replies: [{ ok: true, status: 200, body: new ArrayBuffer(4) }] });
        decodePlans.push({ kind: 'manual' });
        const getChannelData = vi.fn(() => new Float32Array([1]));
        const controller = new AbortController();
        const { fetchAndDecode } = await importSubject();

        const decode = fetchAndDecode('/samples/stale.wav', controller.signal);
        await waitForDecodeRequestCount({ count: 1 });
        controller.abort();
        getDecodeRequest({ index: 0 }).resolve({
            numberOfChannels: 1,
            length: 1,
            sampleRate: 48_000,
            getChannelData,
        });

        await expect(decode).rejects.toMatchObject({ name: 'AbortError' });
        expect(getChannelData).not.toHaveBeenCalled();
    });

    it('should normalize non-Error decode failures', async () => {
        installOfflineAudioContext();
        stubFetch({ replies: [{ ok: true, status: 200, body: new ArrayBuffer(8) }] });
        decodePlans.push({ kind: 'reject', error: 'bad decode' });
        const { fetchAndDecode } = await importSubject();

        await expect(fetchAndDecode('/samples/bad.wav')).rejects.toThrow('bad decode');
    });
});
