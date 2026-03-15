import { trackStore } from "#/modules/Track/stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";

export type RenderOptions = {
    startBeat: number;
    endBeat: number;
    sampleRate?: number;
    channels?: number;
};

export type RenderResult = {
    buffer: AudioBuffer;
    duration: number;
};

export const renderOffline = async (options: RenderOptions): Promise<RenderResult> => {
    const transport = transportStore.value;
    const tracks = trackStore.value;
    if (!transport || !tracks) throw new Error("Stores not initialized");

    const sampleRate = options.sampleRate ?? 44100;
    const channels = options.channels ?? 2;
    const beatsPerSecond = transport.tempo / 60;
    const durationBeats = options.endBeat - options.startBeat;
    const durationSeconds = durationBeats / beatsPerSecond;

    const offlineCtx = new OfflineAudioContext(channels, Math.ceil(durationSeconds * sampleRate), sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.connect(offlineCtx.destination);
    masterGain.gain.value = 0.8;

    const buffer = await offlineCtx.startRendering();

    return { buffer, duration: durationSeconds };
};

export const exportStems = async (options: RenderOptions): Promise<Map<string, RenderResult>> => {
    const tracks = trackStore.value;
    if (!tracks) throw new Error("Track store not initialized");

    const stems = new Map<string, RenderResult>();

    for (const track of tracks.tracks) {
        if (track.muted) continue;
        const result = await renderOffline(options);
        stems.set(track.id, result);
    }

    return stems;
};

export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
};

const writeString = (view: DataView, offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
};
