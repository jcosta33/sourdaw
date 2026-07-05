/**
 * Resample audio using OfflineAudioContext.
 */
export async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
    if (buffer.sampleRate === targetRate) {
        return buffer;
    }

    const ratio = targetRate / buffer.sampleRate;
    const newLength = Math.round(buffer.length * ratio);
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, newLength, targetRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return ctx.startRendering();
}
