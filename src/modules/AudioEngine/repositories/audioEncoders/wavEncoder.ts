export async function audioBufferToWav(
    buffer: AudioBuffer,
    bitDepth: 16 | 24 | 32 = 16,
    onProgress?: (frac: number) => void
): Promise<ArrayBuffer> {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const bitsPerSample = bitDepth;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const fmtSize = isFloat ? 18 : 16;
    const headerLength = 20 + fmtSize + 8;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    function writeString(offset: number, str: string) {
        for (let index = 0; index < str.length; index++) {
            view.setUint8(offset + index, str.charCodeAt(index));
        }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, isFloat ? 3 : 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    if (isFloat) {
        view.setUint16(36, 0, true);
    }

    const dataOffset = 12 + 8 + fmtSize;
    writeString(dataOffset, 'data');
    view.setUint32(dataOffset + 4, dataLength, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    function tpdfDither(): number {
        return Math.random() - Math.random();
    }

    /**
     * Degrade a non-finite sample so it can never poison the file:
     * ±Infinity becomes full scale, NaN becomes silence. Finite samples
     * pass through untouched.
     */
    function sanitizeSample(value: number): number {
        if (Number.isFinite(value)) {
            return value;
        }
        if (value === Number.POSITIVE_INFINITY) {
            return 1;
        }
        if (value === Number.NEGATIVE_INFINITY) {
            return -1;
        }
        return 0;
    }

    // Peak-normalization scan. Find the largest absolute FINITE sample across
    // every channel so a hot mix can be scaled to full scale instead of
    // hard-clipped to a flat top. Only attenuate when the peak exceeds full
    // scale (peak > 1); sub-full-scale material keeps its authored level (it
    // is never boosted up). Non-finite samples are excluded from the scan —
    // a single ±Infinity sample would otherwise set gain = 1/Infinity = 0 and
    // silently zero the entire export; they degrade per-sample at write time
    // via sanitizeSample instead.
    let peak = 0;
    for (let ch = 0; ch < numChannels; ch++) {
        const data = channels[ch]!;
        for (let index = 0; index < buffer.length; index++) {
            const abs = Math.abs(data[index]!);
            if (Number.isFinite(abs) && abs > peak) {
                peak = abs;
            }
        }
    }
    const gain = peak > 1 ? 1 / peak : 1;

    const YIELD_INTERVAL = 32768;
    const totalSamples = buffer.length * numChannels || 1;
    let processed = 0;

    // Channel-outer / sample-inner: each channel's Float32Array is read
    // sequentially (cache-friendly) rather than striding across N separate
    // channel arrays every frame. Writes stride by blockAlign back into the
    // same interleaved layout, so the emitted bytes are identical.
    for (let ch = 0; ch < numChannels; ch++) {
        const data = channels[ch]!;
        let offset = dataOffset + 8 + ch * bytesPerSample;
        for (let index = 0; index < buffer.length; index++) {
            const sample = sanitizeSample(data[index]! * gain);
            if (bitDepth === 16) {
                const dithered = sample + tpdfDither() / 0x8000;
                const clamped = Math.max(-1, Math.min(1, dithered));
                view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
            } else if (bitDepth === 24) {
                const val = sample < 0 ? sample * 0x800000 : sample * 0x7fffff;
                const int = Math.round(val);
                view.setUint8(offset, int & 0xff);
                view.setUint8(offset + 1, (int >> 8) & 0xff);
                view.setUint8(offset + 2, (int >> 16) & 0xff);
            } else {
                view.setFloat32(offset, sample, true);
            }
            offset += blockAlign;

            processed++;
            if (processed % YIELD_INTERVAL === 0) {
                onProgress?.(processed / totalSamples);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    onProgress?.(1);
    return arrayBuffer;
}
