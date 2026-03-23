async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
    if ('showSaveFilePicker' in window) {
        try {
            const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
            const mimeMap: Record<string, string> = {
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg',
                '.flac': 'audio/flac',
                '.webdaw': 'application/json',
                '.json': 'application/json',
            };
            const handle = await (
                window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }
            ).showSaveFilePicker({
                suggestedName: filename,
                types: ext
                    ? [
                          {
                              description: `${ext.slice(1).toUpperCase()} file`,
                              accept: { [mimeMap[ext] ?? 'application/octet-stream']: [ext] },
                          },
                      ]
                    : undefined,
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch {
            return;
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}

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
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
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

    const tpdfDither = (): number => Math.random() - Math.random();

    let offset = dataOffset + 8;
    const YIELD_INTERVAL = 32768;

    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
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
            offset += bytesPerSample;
        }

        if (i > 0 && i % YIELD_INTERVAL === 0) {
            onProgress?.(i / buffer.length);
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }

    onProgress?.(1);
    return arrayBuffer;
}

export async function downloadWav(
    buffer: AudioBuffer,
    filename = 'export.wav',
    bitDepth: 16 | 24 | 32 = 16,
    onProgress?: (frac: number) => void
): Promise<void> {
    const wav = await audioBufferToWav(buffer, bitDepth, onProgress);
    const blob = new Blob([wav], { type: 'audio/wav' });
    await triggerBlobDownload(blob, filename);
}
