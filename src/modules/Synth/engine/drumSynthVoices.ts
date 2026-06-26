/**
 * 808 drum voice scheduling — synthesized analog drum sounds.
 * Each voice type has its own audio graph topology modelling real analog drum machines.
 *
 * 808 Kick:   Sine osc with rapid pitch sweep + body resonance
 * 808 Snare:  Noise burst + sine body tone
 * 808 Clap:   Filtered noise with multi-tap echo
 * 808 HH:     6 detuned square oscillators (metallic) + highpass noise
 * 808 Tom:    Sine with pitch sweep (less extreme than kick)
 * 808 Cowbell: Two detuned square oscillators + bandpass
 * 808 Rimshot: Short noise + high sine click
 * 808 Conga:  Sine with moderate pitch sweep
 */

import { type DrumVoiceType } from '../models/DrumSynthTypes';

// Disconnect every node in a voice's graph once its longest-running source
// ends, mirroring the `onended` teardown discipline in builtinSynth.ts. Without
// this, stopped 808 nodes stay connected to `dest` until GC collects them; on a
// dense pattern that lets AudioNodes accumulate. `disconnect` on an
// already-disconnected node throws, so each call is guarded.
function disconnectOnEnded(lastSource: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    lastSource.onended = () => {
        for (const node of nodes) {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        }
    };
}

// §157.1 — Cache noise buffers per (ctx, durationSec) so we don't allocate
// and re-seed a Float32Array on every drum note. The buffer content is
// white noise; reusing the same buffer for multiple voices is perceptually
// indistinguishable from a fresh one because each BufferSource starts at
// a different point in time.
const noiseBufferCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

function createNoiseBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
    let ctxMap = noiseBufferCache.get(ctx);
    if (!ctxMap) {
        ctxMap = new Map();
        noiseBufferCache.set(ctx, ctxMap);
    }
    const existing = ctxMap.get(durationSec);
    if (existing) {
        return existing;
    }
    const length = Math.ceil(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    ctxMap.set(durationSec, buffer);
    return buffer;
}

function schedule808Kick(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;
    const osc = ctx.createOscillator();
    osc.type = 'sine';

    osc.frequency.setValueAtTime(150, startTime);
    osc.frequency.exponentialRampToValueAtTime(50, startTime + 0.04);
    osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 1.2, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const x = i / 128 - 1;
        curve[i] = ((Math.PI + 3) * x) / (Math.PI + 3 * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    osc.connect(shaper);
    shaper.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(startTime + 0.9);
    disconnectOnEnded(osc, [osc, shaper, gain]);
}

function schedule808Snare(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;

    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(180, startTime);
    bodyOsc.frequency.exponentialRampToValueAtTime(120, startTime + 0.05);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(vel * 0.7, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(dest);
    bodyOsc.start(startTime);
    bodyOsc.stop(startTime + 0.2);
    disconnectOnEnded(bodyOsc, [bodyOsc, bodyGain]);

    const noiseBuffer = createNoiseBuffer(ctx, 0.3);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vel * 0.8, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.3);
    disconnectOnEnded(noise, [noise, noiseFilter, noiseGain]);
}

function schedule808Clap(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;
    const noiseBuffer = createNoiseBuffer(ctx, 0.4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 3;

    const burstTimes = [0, 0.015, 0.03];
    for (const offset of burstTimes) {
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, startTime + offset);
        env.gain.linearRampToValueAtTime(vel * 0.6, startTime + offset + 0.001);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + offset + 0.02);
        noise.connect(env);
        env.connect(filter);
        noise.start(startTime + offset);
        noise.stop(startTime + offset + 0.03);
        disconnectOnEnded(noise, [noise, env]);
    }

    const tailNoise = ctx.createBufferSource();
    tailNoise.buffer = noiseBuffer;
    const tailEnv = ctx.createGain();
    tailEnv.gain.setValueAtTime(vel * 0.5, startTime + 0.04);
    tailEnv.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
    tailNoise.connect(tailEnv);
    tailEnv.connect(filter);
    tailNoise.start(startTime + 0.04);
    tailNoise.stop(startTime + 0.35);

    filter.connect(dest);
    // tailNoise is the last source to end; tear down the shared filter with it.
    disconnectOnEnded(tailNoise, [tailNoise, tailEnv, filter]);
}

function schedule808HiHat(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    isOpen: boolean
): void {
    const vel = velocity / 127;
    const decayTime = isOpen ? 0.4 : 0.06;

    const fundamentals = [800, 1046.5, 1318.5, 1480, 1661.2, 1864.7];
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vel * 0.25, startTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);

    const oscillators: OscillatorNode[] = [];
    for (const freq of fundamentals) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(oscGain);
        osc.start(startTime);
        osc.stop(startTime + decayTime + 0.01);
        oscillators.push(osc);
    }

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 7000;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 10000;
    bpf.Q.value = 1;

    oscGain.connect(hpf);
    hpf.connect(bpf);
    bpf.connect(dest);
    // All oscillators stop together; tear the graph down on the last one's end.
    disconnectOnEnded(oscillators[oscillators.length - 1]!, [...oscillators, oscGain, hpf, bpf]);
}

function schedule808Tom(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    pitch: 'low' | 'mid' | 'high'
): void {
    const vel = velocity / 127;
    const baseFreqs: Record<string, [number, number]> = {
        low: [120, 70],
        mid: [165, 100],
        high: [220, 140],
    };
    const [startFreq, endFreq] = baseFreqs[pitch]!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.7, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.35);
    disconnectOnEnded(osc, [osc, gain]);
}

function schedule808Cowbell(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;
    const freqs = [560, 845];

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 700;
    bpf.Q.value = 5;

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(vel * 0.5, startTime);
    envGain.gain.exponentialRampToValueAtTime(vel * 0.15, startTime + 0.02);
    envGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

    const oscillators: OscillatorNode[] = [];
    for (const freq of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(bpf);
        osc.start(startTime);
        osc.stop(startTime + 0.4);
        oscillators.push(osc);
    }

    bpf.connect(envGain);
    envGain.connect(dest);
    disconnectOnEnded(oscillators[oscillators.length - 1]!, [...oscillators, bpf, envGain]);
}

function schedule808Rimshot(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1700;

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(vel * 0.6, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.03);

    osc.connect(bodyGain);
    bodyGain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.04);
    disconnectOnEnded(osc, [osc, bodyGain]);

    const noiseBuffer = createNoiseBuffer(ctx, 0.05);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 6000;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.4, startTime);
    nGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.025);
    noise.connect(hpf);
    hpf.connect(nGain);
    nGain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.05);
    disconnectOnEnded(noise, [noise, hpf, nGain]);
}

function schedule808Conga(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    pitch: 'low' | 'mid' | 'high'
): void {
    const vel = velocity / 127;
    const freqMap: Record<string, number> = { low: 200, mid: 310, high: 420 };
    const freq = freqMap[pitch]!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.5, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.01);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.6, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.25);
    disconnectOnEnded(osc, [osc, gain]);
}

function schedule808Maracas(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;
    const noiseBuffer = createNoiseBuffer(ctx, 0.1);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 8000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.35, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);

    noise.connect(hpf);
    hpf.connect(gain);
    gain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.1);
    disconnectOnEnded(noise, [noise, hpf, gain]);
}

function schedule808Clave(ctx: BaseAudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const vel = velocity / 127;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 2500;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 2500;
    bpf.Q.value = 15;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.5, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);

    osc.connect(bpf);
    bpf.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.05);
    disconnectOnEnded(osc, [osc, bpf, gain]);
}

/**
 * Schedule a drum voice at the given time.
 */
export function scheduleDrumVoice(
    ctx: BaseAudioContext,
    dest: AudioNode,
    voiceType: DrumVoiceType,
    startTime: number,
    velocity: number
): void {
    switch (voiceType) {
        case 'kick':
            schedule808Kick(ctx, dest, startTime, velocity);
            break;
        case 'snare':
            schedule808Snare(ctx, dest, startTime, velocity);
            break;
        case 'clap':
            schedule808Clap(ctx, dest, startTime, velocity);
            break;
        case 'closed-hh':
            schedule808HiHat(ctx, dest, startTime, velocity, false);
            break;
        case 'open-hh':
            schedule808HiHat(ctx, dest, startTime, velocity, true);
            break;
        case 'tom-low':
            schedule808Tom(ctx, dest, startTime, velocity, 'low');
            break;
        case 'tom-mid':
            schedule808Tom(ctx, dest, startTime, velocity, 'mid');
            break;
        case 'tom-high':
            schedule808Tom(ctx, dest, startTime, velocity, 'high');
            break;
        case 'cowbell':
            schedule808Cowbell(ctx, dest, startTime, velocity);
            break;
        case 'rimshot':
            schedule808Rimshot(ctx, dest, startTime, velocity);
            break;
        case 'conga-low':
            schedule808Conga(ctx, dest, startTime, velocity, 'low');
            break;
        case 'conga-mid':
            schedule808Conga(ctx, dest, startTime, velocity, 'mid');
            break;
        case 'conga-high':
            schedule808Conga(ctx, dest, startTime, velocity, 'high');
            break;
        case 'maracas':
            schedule808Maracas(ctx, dest, startTime, velocity);
            break;
        case 'clave':
            schedule808Clave(ctx, dest, startTime, velocity);
            break;
    }
}
