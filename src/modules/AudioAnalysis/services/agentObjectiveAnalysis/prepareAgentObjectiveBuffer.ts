import { readRenderChannels } from './readRenderChannels';

export function prepareAgentObjectiveBuffer(buffer: AudioBuffer) {
    const channels = readRenderChannels(buffer);
    const { length, sampleRate } = buffer;
    return {
        channels,
        length,
        sampleRate,
        // Figures use the duration the samples describe rather than a caller-supplied duration.
        durationSeconds: sampleRate > 0 ? length / sampleRate : 0,
    };
}

type PreparedBuffer = ReturnType<typeof prepareAgentObjectiveBuffer>;

/** Equal-weight sum of every channel, so an attack outside channel zero still contributes. */
export function prepareAgentObjectiveOnsets({ channels, length, sampleRate }: PreparedBuffer) {
    const channel = new Float32Array(length);
    for (const source of channels) {
        for (let index = 0; index < length; index++) {
            channel[index] = (channel[index] ?? 0) + (source[index] ?? 0) / channels.length;
        }
    }
    return {
        channel,
        length,
        sampleRate,
        source: { sampleRate, getChannelData: () => channel },
        /** Low enough for steady-passage accents, high enough to ignore noise. */
        sensitivity: 0.3,
        /** Sixteenths at 300 BPM; closer attacks are one event. */
        minIntervalSeconds: 0.05,
    };
}

/** Programme and objective figures must read the same finite-safe channel views. */
export function prepareAgentObjectiveProgramme({ channels, length, sampleRate }: PreparedBuffer) {
    return {
        numberOfChannels: channels.length,
        length,
        sampleRate,
        getChannelData: (channel: number) => channels[channel] ?? new Float32Array(length),
    };
}
