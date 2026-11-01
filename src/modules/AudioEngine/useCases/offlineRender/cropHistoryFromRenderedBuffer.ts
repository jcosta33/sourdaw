type CropHistoryFromRenderedBufferInput = {
    buffer: AudioBuffer;
    historyFrameCount: number;
    outputFrameCount: number;
    borrowed?: boolean;
};

type BorrowedRenderWindow = Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'sampleRate' | 'getChannelData'>;

export function cropHistoryFromRenderedBuffer(
    input: CropHistoryFromRenderedBufferInput & { borrowed: true }
): BorrowedRenderWindow;
export function cropHistoryFromRenderedBuffer(input: CropHistoryFromRenderedBufferInput): AudioBuffer;
/** Returns the requested window after a timeline-zero history render. */
export function cropHistoryFromRenderedBuffer({
    buffer,
    historyFrameCount,
    outputFrameCount,
    borrowed = false,
}: CropHistoryFromRenderedBufferInput): AudioBuffer | BorrowedRenderWindow {
    if (historyFrameCount <= 0) {
        return buffer;
    }

    const startFrame = historyFrameCount;
    const endFrame = startFrame + outputFrameCount;
    if (endFrame > buffer.length) {
        throw new Error('The requested region falls outside the renderer frame limit');
    }

    if (borrowed) {
        return {
            length: outputFrameCount,
            sampleRate: buffer.sampleRate,
            numberOfChannels: buffer.numberOfChannels,
            getChannelData: (channel) => buffer.getChannelData(channel).subarray(startFrame, endFrame),
        };
    }

    const output = new AudioBuffer({
        length: outputFrameCount,
        numberOfChannels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
    });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        output.copyToChannel(buffer.getChannelData(channel).subarray(startFrame, endFrame), channel);
    }
    return output;
}
