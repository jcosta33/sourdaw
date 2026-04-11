// ---------------------------------------------------------------------------
// LOD configuration
// ---------------------------------------------------------------------------

export type SampleLodConfig = {
    /** Maximum mic positions to load (0 = all). */
    maxMics: number;
    /** Maximum velocity layers per articulation (0 = all). */
    maxVelLayers: number;
    /** Maximum round-robin groups (0 = all). */
    maxRoundRobins: number;
    /** Disable legato transition samples. */
    disableTransitions: boolean;
};

export const WEB_LOD: SampleLodConfig = {
    maxMics: 2,
    maxVelLayers: 3,
    maxRoundRobins: 3,
    disableTransitions: false,
};

export // ---------------------------------------------------------------------------
// Audio decoding
// ---------------------------------------------------------------------------

/**
 * Fetch and decode an audio file to Float32 PCM.
 * Returns { data, frameCount, channels, sampleRate }.
 * Uses a fresh OfflineAudioContext per decode to avoid state issues.
 */
// Use a single global context for decoding to avoid WKWebView context limits.
let decodeCtx: OfflineAudioContext | null = null;

export function getDecodeContext(): OfflineAudioContext {
    if (!decodeCtx) {
        decodeCtx = new OfflineAudioContext(2, 44100, 44100);
    }
    return decodeCtx;
}

export // Global queue to prevent Safari from crashing on concurrent decode requests
let decodeQueue = Promise.resolve();

export async function fetchAndDecode(url: string): Promise<{
    data: Float32Array;
    frameCount: number;
    channels: number;
    sampleRate: number;
}> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch sample: ${url} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // Strictly sequence decoding to avoid WebKit EncodingError
    return new Promise((resolve, reject) => {
        decodeQueue = decodeQueue.then(async () => {
            try {
                const ctx = getDecodeContext();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                const channels = audioBuffer.numberOfChannels;
                const frameCount = audioBuffer.length;
                const sampleRate = audioBuffer.sampleRate;

                const data = new Float32Array(frameCount * channels);
                for (let ch = 0; ch < channels; ch++) {
                    const channelData = audioBuffer.getChannelData(ch);
                    for (let i = 0; i < frameCount; i++) {
                        data[i * channels + ch] = channelData[i] ?? 0;
                    }
                }
                resolve({ data, frameCount, channels, sampleRate });
            } catch (err) {
                reject(err);
            }
        });
    });
}