type CropHistoryFromRenderedBufferInput = {
    buffer: AudioBuffer;
    historySeconds: number;
    outputDurationSeconds: number;
};

/** Returns the requested window after a timeline-zero history render. */
export function cropHistoryFromRenderedBuffer({
    buffer,
    historySeconds,
    outputDurationSeconds,
}: CropHistoryFromRenderedBufferInput): AudioBuffer {
    if (historySeconds <= 0) {
        return buffer;
    }

    const startFrame = Math.round(historySeconds * buffer.sampleRate);
    const outputFrameCount = Math.ceil(outputDurationSeconds * buffer.sampleRate);
    const endFrame = startFrame + outputFrameCount;
    if (startFrame < 0 || endFrame > buffer.length) {
        throw new Error('The requested region falls outside the renderer frame limit');
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
