import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';

type DecodedImpulseResponse = {
    data: Float32Array;
    channels: number;
    sampleRate: number;
    waveform: number[];
};

export async function decodeImpulseResponse(file: File): Promise<DecodedImpulseResponse> {
    const audioBuffer = await decodeAudioFileBuffer(file);
    const channels = audioBuffer.numberOfChannels;
    const frameCount = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    const data = new Float32Array(frameCount * channels);
    for (let channel = 0; channel < channels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let index = 0; index < frameCount; index++) {
            data[index * channels + channel] = channelData[index] ?? 0;
        }
    }

    const mono = audioBuffer.getChannelData(0);
    const pointCount = Math.min(200, mono.length);
    const samplesPerPoint = pointCount === 0 ? 1 : Math.floor(mono.length / pointCount);
    const waveform: number[] = [];
    for (let point = 0; point < pointCount; point++) {
        let peak = 0;
        const start = point * samplesPerPoint;
        const end = point === pointCount - 1 ? mono.length : start + samplesPerPoint;
        for (let sample = start; sample < end; sample++) {
            const value = Math.abs(mono[sample] ?? 0);
            if (value > peak) {
                peak = value;
            }
        }
        waveform.push(peak);
    }

    return { data, channels, sampleRate, waveform };
}
