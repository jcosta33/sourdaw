import { readFileBytes } from '#/utils/desktopBridge';

import { getCrumbsDecodeContext } from './getCrumbsDecodeContext';

type DecodeCrumbsSampleFileInput = {
    /** Absolute path the native loader recorded on the device's active sample. */
    filePath: string;
};

type DecodeCrumbsSampleFileOutput = Promise<{
    /** Interleaved PCM, which is the layout `CrumbsInstance::add_sample` reads. */
    data: Float32Array;
    frameCount: number;
    channels: number;
    sampleRate: number;
}>;

/**
 * Read a Crumbs sample off disk and decode it to interleaved PCM the worklet
 * can be handed.
 *
 * The wasm engine cannot do either half itself — a worklet has no filesystem
 * and no decoder — so the bytes are read over the native bridge here and
 * decoded on the main thread, then transferred in. That is why this is a
 * repository: it is the only desktop-bridge touch in the path.
 */
export async function decodeCrumbsSampleFile({ filePath }: DecodeCrumbsSampleFileInput): DecodeCrumbsSampleFileOutput {
    const bytes = await readFileBytes({ path: filePath });
    // `decodeAudioData` detaches the buffer it is given, and `bytes` may be a
    // view into a larger allocation, so hand it its own copy.
    const encoded = bytes.slice().buffer;

    const audioBuffer = await getCrumbsDecodeContext().decodeAudioData(encoded);

    const channels = audioBuffer.numberOfChannels;
    const frameCount = audioBuffer.length;
    const data = new Float32Array(frameCount * channels);
    for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
        const channelData = audioBuffer.getChannelData(channelIndex);
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            data[frameIndex * channels + channelIndex] = channelData[frameIndex] ?? 0;
        }
    }

    return { data, frameCount, channels, sampleRate: audioBuffer.sampleRate };
}
