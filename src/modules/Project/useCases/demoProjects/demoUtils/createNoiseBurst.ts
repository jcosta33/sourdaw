type NoiseBurstConnectable = {
    connect(target: NoiseBurstConnectable): unknown;
};

type NoiseBurstBuffer = {
    getChannelData(channel: number): Float32Array;
};

type NoiseBurstBufferSource = NoiseBurstConnectable & {
    buffer: NoiseBurstBuffer | null;
    start(time: number): void;
    stop(time: number): void;
};

type NoiseBurstGain = NoiseBurstConnectable & {
    gain: {
        setValueAtTime(value: number, time: number): void;
        exponentialRampToValueAtTime(value: number, time: number): void;
    };
};

type NoiseBurstFilter = NoiseBurstConnectable & {
    type: BiquadFilterType;
    frequency: {
        value: number;
    };
};

type NoiseBurstContext = {
    destination: NoiseBurstConnectable;
    createBufferSource(): NoiseBurstBufferSource;
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): NoiseBurstBuffer;
    createGain(): NoiseBurstGain;
    createBiquadFilter(): NoiseBurstFilter;
};

type CreateNoiseBurstInput = {
    ctx: NoiseBurstContext;
    time: number;
    duration: number;
    vol: number;
    filterType: BiquadFilterType;
    freq: number;
};

export function createNoiseBurst(input: CreateNoiseBurstInput): void {
    const noise = input.ctx.createBufferSource();
    const noiseBuf = input.ctx.createBuffer(1, Math.ceil(input.duration * 44100), 44100);
    const data = noiseBuf.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
        data[index] = Math.random() * 2 - 1;
    }
    noise.buffer = noiseBuf;
    const env = input.ctx.createGain();
    env.gain.setValueAtTime(input.vol, input.time);
    env.gain.exponentialRampToValueAtTime(0.001, input.time + input.duration);
    const filter = input.ctx.createBiquadFilter();
    filter.type = input.filterType;
    filter.frequency.value = input.freq;
    noise.connect(filter);
    filter.connect(env);
    env.connect(input.ctx.destination);
    noise.start(input.time);
    noise.stop(input.time + input.duration + 0.1);
}
