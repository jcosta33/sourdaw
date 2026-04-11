import { audioBufferCache } from '#/modules/AudioEngine/stores';

export function createNoiseBurst(
    ctx: OfflineAudioContext,
    time: number,
    duration: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number
) {
    const noise = ctx.createBufferSource();
    const noiseBuf = ctx.createBuffer(1, Math.ceil(duration * 44100), 44100);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    noise.buffer = noiseBuf;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    noise.connect(filter);
    filter.connect(env);
    env.connect(ctx.destination);
    noise.start(time);
    noise.stop(time + duration + 0.1);
}

export async function generateDemoDrumBuffer(
    bufferId: string,
    beats: number,
    bpm: number,
    style: '4onFloor' | 'electro' | 'shaker' | 'kick' | 'snare' | 'hat'
): Promise<void> {
try {
    const bps = bpm / 60;
    const durationSecs = beats / bps;
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * durationSecs), 44100);

    for (let step = 0; step < beats * 4; step++) {
        const beat = step * 0.25;
        const time = beat / bps;
        const pos = beat % 4;

        if (style === 'shaker') {
            if (step % 2 === 0) {
                const vol = step % 4 === 0 ? 0.3 : 0.15;
                createNoiseBurst(ctx, time, 0.05, vol, 'highpass', 4000);
            }
            continue;
        }

        const isKick =
            style === 'kick'
                ? pos === 0 || pos === 2
                : style === '4onFloor'
                  ? pos === 0 || pos === 2
                  : style === 'electro'
                    ? pos === 0 || pos === 2.5
                    : false;

        const isSnare =
            style === 'snare' ? pos === 1 || pos === 3 : style === 'electro' ? pos === 1 || pos === 3 : false;

        const isHat =
            (style === 'hat' || style === '4onFloor') &&
            step % 4 === 2 &&
            pos !== 0 &&
            pos !== 1 &&
            pos !== 2 &&
            pos !== 3;

        if (isKick) {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.frequency.setValueAtTime(style === 'electro' ? 120 : 150, time);
            osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
            env.gain.setValueAtTime(0.8, time);
            env.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
            osc.connect(env);
            env.connect(ctx.destination);
            osc.start(time);
            osc.stop(time + 0.3);
        }
        if (isSnare) {
            createNoiseBurst(ctx, time, 0.15, 0.6, 'highpass', 2000);
            const osc2 = ctx.createOscillator();
            const env2 = ctx.createGain();
            osc2.frequency.value = 200;
            osc2.type = 'triangle';
            env2.gain.setValueAtTime(0.15, time);
            env2.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
            osc2.connect(env2);
            env2.connect(ctx.destination);
            osc2.start(time);
            osc2.stop(time + 0.1);
        }
        if (isHat) {
            if (style === 'hat') {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                const isHigh = step % 8 === 2;
                osc.frequency.setValueAtTime(isHigh ? 650 : 450, time);
                osc.frequency.exponentialRampToValueAtTime(isHigh ? 550 : 380, time + 0.05);
                env.gain.setValueAtTime(0.7, time);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
                osc.connect(env);
                env.connect(ctx.destination);
                osc.start(time);
                osc.stop(time + 0.15);
            } else {
                createNoiseBurst(ctx, time, 0.04, 0.22, 'highpass', 9000);
            }
        }
    }

    const rendered = await ctx.startRendering();
    audioBufferCache.set(bufferId, rendered);
} catch {}
}