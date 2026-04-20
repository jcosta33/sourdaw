export // ── Convolution Reverb ──────────────────────────────────────────────────

type IRConfig = {
    sampleRate: number;
    duration: number;
    decayT60: number;
    earlyMs: number;
    earlyLevel: number;
    diffusion: number;
    hfDamping: number;
    lfDamping: number;
};

type IRGenerator = (sampleRate: number) => AudioBuffer;

export function generateIR(config: IRConfig): AudioBuffer {
    const { sampleRate, duration, decayT60, earlyMs, earlyLevel, diffusion, hfDamping, lfDamping } = config;
    const len = Math.ceil(sampleRate * duration);
    const buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate });
    const decayRate = -6.9078 / (decayT60 * sampleRate);
    const earlySamples = Math.floor((earlyMs * sampleRate) / 1000);

    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        let lpState = 0;
        const lpCoeff = Math.exp((-2 * Math.PI * hfDamping) / sampleRate);
        let hpState = 0;
        const hpCoeff = Math.exp((-2 * Math.PI * lfDamping) / sampleRate);

        for (let i = 0; i < len; i++) {
            let sample = Math.random() * 2 - 1;
            const isEarly = i < earlySamples;
            if (isEarly) {
                const spacing = Math.floor(sampleRate * 0.003 * (1 + ch * 0.2));
                if (i % spacing < 2) {
                    sample *= earlyLevel;
                } else {
                    sample *= earlyLevel * diffusion * 0.3;
                }
            }
            const envelope = Math.exp(decayRate * i);
            sample *= envelope;
            const dampProgress = i / len;
            const effectiveLpCoeff = lpCoeff * (1 - dampProgress * 0.3);
            lpState = lpState * effectiveLpCoeff + sample * (1 - effectiveLpCoeff);
            sample = sample * (1 - diffusion) + lpState * diffusion;
            if (lfDamping > 10) {
                hpState = hpState * hpCoeff + sample * (1 - hpCoeff);
                sample = sample - hpState * 0.5;
            }
            data[i] = sample;
        }
    }
    return buf;
}

export const IR_GENERATORS: Record<string, IRGenerator> = {
    'small-room': (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 0.6,
            decayT60: 0.4,
            earlyMs: 15,
            earlyLevel: 2.0,
            diffusion: 0.6,
            hfDamping: 6000,
            lfDamping: 80,
        }),
    'large-hall': (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 4.0,
            decayT60: 3.0,
            earlyMs: 60,
            earlyLevel: 1.5,
            diffusion: 0.8,
            hfDamping: 4000,
            lfDamping: 40,
        }),
    cathedral: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 6.0,
            decayT60: 5.0,
            earlyMs: 100,
            earlyLevel: 1.2,
            diffusion: 0.9,
            hfDamping: 3000,
            lfDamping: 30,
        }),
    plate: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 2.5,
            decayT60: 2.0,
            earlyMs: 5,
            earlyLevel: 2.5,
            diffusion: 0.7,
            hfDamping: 8000,
            lfDamping: 100,
        }),
    spring: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 1.5,
            decayT60: 1.2,
            earlyMs: 3,
            earlyLevel: 3.0,
            diffusion: 0.4,
            hfDamping: 6000,
            lfDamping: 200,
        }),
    chamber: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 1.2,
            decayT60: 0.8,
            earlyMs: 25,
            earlyLevel: 1.8,
            diffusion: 0.7,
            hfDamping: 5000,
            lfDamping: 60,
        }),
    'studio-a': (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 0.8,
            decayT60: 0.5,
            earlyMs: 10,
            earlyLevel: 2.2,
            diffusion: 0.5,
            hfDamping: 7000,
            lfDamping: 100,
        }),
    'studio-b': (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 1.0,
            decayT60: 0.7,
            earlyMs: 20,
            earlyLevel: 2.0,
            diffusion: 0.6,
            hfDamping: 6000,
            lfDamping: 80,
        }),
    warehouse: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 3.5,
            decayT60: 2.5,
            earlyMs: 80,
            earlyLevel: 1.0,
            diffusion: 0.85,
            hfDamping: 3500,
            lfDamping: 50,
        }),
    tunnel: (sr) =>
        generateIR({
            sampleRate: sr,
            duration: 2.0,
            decayT60: 1.5,
            earlyMs: 40,
            earlyLevel: 1.5,
            diffusion: 0.9,
            hfDamping: 2500,
            lfDamping: 100,
        }),
};
