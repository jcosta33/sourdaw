export // ── Convolution Reverb ──────────────────────────────────────────────────

type IRGenerator = (sampleRate: number) => AudioBuffer;

export function generateIR(
    sampleRate: number,
    duration: number,
    decayT60: number,
    earlyMs: number,
    earlyLevel: number,
    diffusion: number,
    hfDamping: number,
    lfDamping: number
): AudioBuffer {
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
    'small-room': (sr) => generateIR(sr, 0.6, 0.4, 15, 2.0, 0.6, 6000, 80),
    'large-hall': (sr) => generateIR(sr, 4.0, 3.0, 60, 1.5, 0.8, 4000, 40),
    cathedral: (sr) => generateIR(sr, 6.0, 5.0, 100, 1.2, 0.9, 3000, 30),
    plate: (sr) => generateIR(sr, 2.5, 2.0, 5, 2.5, 0.7, 8000, 100),
    spring: (sr) => generateIR(sr, 1.5, 1.2, 3, 3.0, 0.4, 6000, 200),
    chamber: (sr) => generateIR(sr, 1.2, 0.8, 25, 1.8, 0.7, 5000, 60),
    'studio-a': (sr) => generateIR(sr, 0.8, 0.5, 10, 2.2, 0.5, 7000, 100),
    'studio-b': (sr) => generateIR(sr, 1.0, 0.7, 20, 2.0, 0.6, 6000, 80),
    warehouse: (sr) => generateIR(sr, 3.5, 2.5, 80, 1.0, 0.85, 3500, 50),
    tunnel: (sr) => generateIR(sr, 2.0, 1.5, 40, 1.5, 0.9, 2500, 100),
};