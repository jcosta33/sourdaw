import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    decode_audio_data: vi.fn(),
    get_audio_context: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mocks.get_audio_context,
}));

function create_audio_buffer(): AudioBuffer {
    const channel_data = new Float32Array([0, 0.25, -0.25, 0]);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / 48_000,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

describe('decodeDawProjectAssets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // AC-5, chain 2. The decoded AudioBuffer is handed on as-is. It used to be
    // base64-encoded here and decoded again a few frames later inside
    // replaceProjectData — an encode/decode round trip that never crossed JSON.
    //
    // Mutation: reinstating `serializeAudioBuffersForProject` on this path reds
    // `expect(Array.from(decoded.getChannelData(0)))`, because the entry becomes
    // a `{ channelData: string[] }` record with no `getChannelData`.
    it('hands back the decoded audio buffer without serializing it', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        const buffer = create_audio_buffer();
        mocks.get_audio_context.mockReturnValue({ decodeAudioData: mocks.decode_audio_data });
        mocks.decode_audio_data.mockResolvedValue(buffer);
        const encoder = vi.fn((value: string) => value);
        vi.stubGlobal('btoa', encoder);

        const result = await decodeDawProjectAssets({
            audioAssets: new Map([['audio/drum-loop.wav', new Uint8Array([1, 2, 3])]]),
        });

        vi.unstubAllGlobals();

        const decoded = result.audioBuffers['audio-11111111-1111-4111-8111-111111111111'];
        expect(result.failedPaths).toEqual([]);
        expect(decoded).toBe(buffer);
        expect(Array.from(decoded!.getChannelData(0))).toEqual([0, 0.25, -0.25, 0]);
        expect(decoded!.sampleRate).toBe(48_000);
        expect(decoded!.numberOfChannels).toBe(1);
        expect(encoder).not.toHaveBeenCalled();
        expect(result.bufferIdsByPath).toEqual(
            new Map([['audio/drum-loop.wav', 'audio-11111111-1111-4111-8111-111111111111']])
        );
    });

    it('should return empty maps without decoding or caching when input has no assets', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        mocks.get_audio_context.mockReturnValue({ decodeAudioData: mocks.decode_audio_data });

        const result = await decodeDawProjectAssets({ audioAssets: new Map() });

        expect(result.bufferIdsByPath).toEqual(new Map());
        expect(result.failedPaths).toEqual([]);
        expect(result.audioBuffers).toEqual({});
        expect(mocks.decode_audio_data).not.toHaveBeenCalled();
    });

    it('should mark every asset as failed when no audio context exists', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        mocks.get_audio_context.mockReturnValue(null);

        const result = await decodeDawProjectAssets({
            audioAssets: new Map([
                ['audio/drums.wav', new Uint8Array([1])],
                ['audio/bass.wav', new Uint8Array([2])],
            ]),
        });

        expect(result.bufferIdsByPath).toEqual(new Map());
        expect(result.failedPaths).toEqual(['audio/drums.wav', 'audio/bass.wav']);
        expect(result.audioBuffers).toEqual({});
        expect(mocks.decode_audio_data).not.toHaveBeenCalled();
    });

    it('should report decode failures without caching failed buffers', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        mocks.get_audio_context.mockReturnValue({ decodeAudioData: mocks.decode_audio_data });
        mocks.decode_audio_data.mockRejectedValue(new Error('decode failed'));

        const result = await decodeDawProjectAssets({
            audioAssets: new Map([['audio/broken.wav', new Uint8Array([9])]]),
        });

        expect(result.bufferIdsByPath).toEqual(new Map());
        expect(result.failedPaths).toEqual(['audio/broken.wav']);
        expect(result.audioBuffers).toEqual({});
    });

    it('does not cache a decoded buffer after transition authority is revoked', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        const buffer = create_audio_buffer();
        let finish_decode: ((value: AudioBuffer) => void) | undefined;
        let should_continue = true;
        mocks.get_audio_context.mockReturnValue({ decodeAudioData: mocks.decode_audio_data });
        mocks.decode_audio_data.mockImplementation(
            () =>
                new Promise<AudioBuffer>((resolve) => {
                    finish_decode = resolve;
                })
        );

        const decoding = decodeDawProjectAssets({
            audioAssets: new Map([['audio/stale.wav', new Uint8Array([1])]]),
            shouldContinue: () => should_continue,
        });
        await vi.waitFor(() => expect(finish_decode).toBeDefined());
        should_continue = false;

        const finish = finish_decode;
        if (!finish) {
            throw new Error('Expected pending audio decode');
        }
        finish(buffer);
        const result = await decoding;

        expect(result.bufferIdsByPath).toEqual(new Map());
        expect(result.audioBuffers).toEqual({});
    });

    it('does not partially cache assets when authority is revoked during a later decode', async () => {
        const { decodeDawProjectAssets } = await import('../decodeDawProjectAssets');
        const firstBuffer = create_audio_buffer();
        const secondBuffer = create_audio_buffer();
        let finishSecondDecode: ((value: AudioBuffer) => void) | undefined;
        let shouldContinue = true;
        mocks.get_audio_context.mockReturnValue({ decodeAudioData: mocks.decode_audio_data });
        mocks.decode_audio_data.mockResolvedValueOnce(firstBuffer).mockImplementationOnce(
            () =>
                new Promise<AudioBuffer>((resolve) => {
                    finishSecondDecode = resolve;
                })
        );

        const decoding = decodeDawProjectAssets({
            audioAssets: new Map([
                ['audio/first.wav', new Uint8Array([1])],
                ['audio/second.wav', new Uint8Array([2])],
            ]),
            shouldContinue: () => shouldContinue,
        });
        await vi.waitFor(() => expect(finishSecondDecode).toBeDefined());
        shouldContinue = false;
        finishSecondDecode?.(secondBuffer);

        await expect(decoding).resolves.toEqual({ audioBuffers: {}, bufferIdsByPath: new Map(), failedPaths: [] });
    });
});
