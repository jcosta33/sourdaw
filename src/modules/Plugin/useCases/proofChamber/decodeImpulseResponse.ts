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
    const points = 200;
    const samplesPerPoint = Math.floor(mono.length / points);
    const waveform: number[] = [];
    for (let point = 0; point < points; point++) {
        let peak = 0;
        for (let sample = 0; sample < samplesPerPoint; sample++) {
            const value = Math.abs(mono[point * samplesPerPoint + sample] ?? 0);
            if (value > peak) {
                peak = value;
            }
        }
        waveform.push(peak);
    }

    return { data, channels, sampleRate, waveform };
}
