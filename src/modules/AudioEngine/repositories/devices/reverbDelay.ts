import { type OfflineDeviceNode } from './types';

// ── Reverb (algorithmic) ─────────────────────────────────────────────────

export function createReverb(ctx: BaseAudioContext): OfflineDeviceNode {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const predelay = ctx.createDelay(1);
    predelay.delayTime.value = 0.01;
    const lowcut = ctx.createBiquadFilter();
    lowcut.type = 'highpass';
    lowcut.frequency.value = 80;
    lowcut.Q.value = 0.7;
    const convolver = ctx.createConvolver();
    const len = ctx.sampleRate * 2;
    const impulse = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: ctx.sampleRate });
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.5));
        }
    }
    convolver.buffer = impulse;
    const merger = ctx.createGain();
    const splitter = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(predelay);
    predelay.connect(lowcut);
    lowcut.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut],
    };
}

export function applyReverbParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dry = dn.nodes[1] as GainNode;
    const wet = dn.nodes[2] as GainNode;
    const predelay = dn.nodes[5] as DelayNode;
    const lowcut = dn.nodes[6] as BiquadFilterNode;
    if (params['rev-mix'] !== undefined) {
        wet.gain.value = params['rev-mix'];
        dry.gain.value = 1 - params['rev-mix'];
    }
    if (params['rev-predelay'] !== undefined) { predelay.delayTime.value = params['rev-predelay'] / 1000; }
    if (params['rev-lowcut'] !== undefined) { lowcut.frequency.value = params['rev-lowcut']; }
}

// ── Delay ────────────────────────────────────────────────────────────────

export function createDelay(ctx: BaseAudioContext): OfflineDeviceNode {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const delay = ctx.createDelay(5);
    delay.delayTime.value = 0.25;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const fbLowcut = ctx.createBiquadFilter();
    fbLowcut.type = 'highpass';
    fbLowcut.frequency.value = 80;
    fbLowcut.Q.value = 0.7;
    const fbHighcut = ctx.createBiquadFilter();
    fbHighcut.type = 'lowpass';
    fbHighcut.frequency.value = 12000;
    fbHighcut.Q.value = 0.7;
    const splitter = ctx.createGain();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(fbLowcut);
    fbLowcut.connect(fbHighcut);
    fbHighcut.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, feedback, merger, fbLowcut, fbHighcut],
    };
}

export function applyDelayParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const delay = dn.nodes[3] as DelayNode;
    const fb = dn.nodes[4] as GainNode;
    const dryD = dn.nodes[1] as GainNode;
    const wetD = dn.nodes[2] as GainNode;
    const fbLowcut = dn.nodes[6] as BiquadFilterNode;
    const fbHighcut = dn.nodes[7] as BiquadFilterNode;
    if (params['delay-time'] !== undefined) { delay.delayTime.value = params['delay-time'] / 1000; }
    if (params['delay-feedback'] !== undefined) { fb.gain.value = params['delay-feedback']; }
    if (params['delay-lowcut'] !== undefined) { fbLowcut.frequency.value = params['delay-lowcut']; }
    if (params['delay-highcut'] !== undefined) { fbHighcut.frequency.value = params['delay-highcut']; }
    if (params['delay-mix'] !== undefined) {
        wetD.gain.value = params['delay-mix'];
        dryD.gain.value = 1 - params['delay-mix'];
    }
}

// ── Convolution Reverb ──────────────────────────────────────────────────

type IRGenerator = (sampleRate: number) => AudioBuffer;

function generateIR(
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

export const IR_NAMES = Object.keys(IR_GENERATORS);

export function createConvolutionReverb(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.6;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    const predelay = ctx.createDelay(0.5);
    predelay.delayTime.value = 0.01;
    const lowcut = ctx.createBiquadFilter();
    lowcut.type = 'highpass';
    lowcut.frequency.value = 60;
    lowcut.Q.value = 0.7;
    const highcut = ctx.createBiquadFilter();
    highcut.type = 'lowpass';
    highcut.frequency.value = 12000;
    highcut.Q.value = 0.7;
    const convolver = ctx.createConvolver();
    convolver.buffer = IR_GENERATORS['studio-a']!(ctx.sampleRate);
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(predelay);
    predelay.connect(lowcut);
    lowcut.connect(highcut);
    highcut.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut, highcut],
    };
}

export function applyConvolutionReverbParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryConv = dn.nodes[1] as GainNode;
    const wetConv = dn.nodes[2] as GainNode;
    const convolverNode = dn.nodes[3] as ConvolverNode;
    const predelayConv = dn.nodes[5] as DelayNode;
    const lowcutConv = dn.nodes[6] as BiquadFilterNode;
    const highcutConv = dn.nodes[7] as BiquadFilterNode;
    if (params['conv-mix'] !== undefined) {
        wetConv.gain.value = params['conv-mix'];
        dryConv.gain.value = 1 - params['conv-mix'];
    }
    if (params['conv-predelay'] !== undefined) { predelayConv.delayTime.value = params['conv-predelay'] / 1000; }
    if (params['conv-lowcut'] !== undefined) { lowcutConv.frequency.value = params['conv-lowcut']; }
    if (params['conv-highcut'] !== undefined) { highcutConv.frequency.value = params['conv-highcut']; }
    if (params['conv-ir'] !== undefined) {
        const irIndex = Math.round(params['conv-ir']);
        const irName = IR_NAMES[irIndex] ?? 'studio-a';
        const gen = IR_GENERATORS[irName];
        if (gen && convolverNode.context) {
            convolverNode.buffer = gen(convolverNode.context.sampleRate);
        }
    }
}
