import { getDecodeContext } from './getDecodeContext';

type FetchAndDecodeOutput = Promise<{
    data: Float32Array;
    frameCount: number;
    channels: number;
    sampleRate: number;
}>;

// Global queue to prevent Safari from crashing on concurrent decode requests.
let decodeQueue: Promise<void> = Promise.resolve();

export async function fetchAndDecode(url: string): FetchAndDecodeOutput {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch sample: ${url} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();

    const queuedDecode = decodeQueue.then(async () => {
        try {
            const context = getDecodeContext();
            const audioBuffer = await context.decodeAudioData(arrayBuffer);
            const channels = audioBuffer.numberOfChannels;
            const frameCount = audioBuffer.length;
            const sampleRate = audioBuffer.sampleRate;

            const data = new Float32Array(frameCount * channels);
            for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
                const channelData = audioBuffer.getChannelData(channelIndex);
                for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
                    data[frameIndex * channels + channelIndex] = channelData[frameIndex] ?? 0;
                }
            }

            return { data, frameCount, channels, sampleRate };
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    });

    decodeQueue = queuedDecode.then(
        () => undefined,
        () => undefined
    );

    return queuedDecode;
}
