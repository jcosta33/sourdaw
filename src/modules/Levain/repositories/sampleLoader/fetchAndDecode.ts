import { getDecodeContext } from './getDecodeContext';

type FetchAndDecodeOutput = Promise<{
    data: Float32Array<SharedArrayBuffer>;
    frameCount: number;
    channels: number;
    sampleRate: number;
}>;

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new DOMException('Levain sample decode aborted', 'AbortError');
    }
}

export async function fetchAndDecode(url: string, signal?: AbortSignal): FetchAndDecodeOutput {
    const response = await fetch(url, signal ? { signal } : undefined);
    if (!response.ok) {
        throw new Error(`Failed to fetch sample: ${url} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    throwIfAborted(signal);

    try {
        const context = getDecodeContext();
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        throwIfAborted(signal);
        const channels = audioBuffer.numberOfChannels;
        const frameCount = audioBuffer.length;
        const sampleRate = audioBuffer.sampleRate;
        if (typeof SharedArrayBuffer === 'undefined') {
            throw new TypeError('Levain sample sharing requires cross-origin isolation');
        }
        const sharedBuffer = new SharedArrayBuffer(frameCount * channels * Float32Array.BYTES_PER_ELEMENT);
        const data = new Float32Array(sharedBuffer);
        for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
            const channelData = audioBuffer.getChannelData(channelIndex);
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
                data[frameIndex * channels + channelIndex] = channelData[frameIndex] ?? 0;
            }
        }

        return { data, frameCount, channels, sampleRate };
    } catch (error) {
        if (error instanceof DOMException) {
            throw error;
        }
        throw error instanceof Error ? error : new Error(String(error));
    }
}
