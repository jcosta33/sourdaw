/**
 * Repository: Audio device node construction and parameter application.
 * Creates Web Audio API node graphs for each device type.
 */

export type OfflineDeviceNode = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    nodes: AudioNode[];
};

function createEq(ctx: BaseAudioContext): OfflineDeviceNode {
    const low = ctx.createBiquadFilter();
    low.type = 'peaking';
    low.frequency.value = 100;
    low.Q.value = 1;
    low.gain.value = 0;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 1;
    mid.gain.value = 0;
    const high = ctx.createBiquadFilter();
    high.type = 'peaking';
    high.frequency.value = 8000;
    high.Q.value = 1;
    high.gain.value = 0;
    low.connect(mid);
    mid.connect(high);
    return { inputNode: low, outputNode: high, nodes: [low, mid, high] };
}

function createCompressor(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    comp.knee.value = 6;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup);
    return { inputNode: comp, outputNode: makeup, nodes: [comp, makeup] };
}

function createReverb(ctx: BaseAudioContext): OfflineDeviceNode {
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

function createDelay(ctx: BaseAudioContext): OfflineDeviceNode {
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

function createGainDevice(ctx: BaseAudioContext): OfflineDeviceNode {
    const g = ctx.createGain();
    g.gain.value = 1;
    return { inputNode: g, outputNode: g, nodes: [g] };
}

function createSidechainCompressorFallback(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup);
    return { inputNode: comp, outputNode: makeup, nodes: [comp, makeup] };
}

function createChorus(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.007;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.005;
    const chorusFeedback = ctx.createGain();
    chorusFeedback.gain.value = 0.2;
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(chorusFeedback);
    chorusFeedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, lfo, lfoGain, merger, chorusFeedback],
    };
}

function createPhaser(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const stageCount = 4;
    const filters: BiquadFilterNode[] = [];
    for (let i = 0; i < stageCount; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 1000;
        ap.Q.value = 0.5;
        filters.push(ap);
    }
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    for (const f of filters) {
        lfoGain.connect(f.frequency);
    }
    lfo.start();
    const feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0.3;
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    input.connect(dry);
    let prev: AudioNode = input;
    for (const f of filters) {
        prev.connect(f);
        prev = f;
    }
    prev.connect(feedbackGain);
    feedbackGain.connect(filters[0]!);
    prev.connect(wet);
    dry.connect(output);
    wet.connect(output);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, ...filters, lfo, lfoGain, feedbackGain, dry, wet, output],
    };
}

function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const k = Math.max(0.1, drive);
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.tanh(k * x);
    }
    return curve;
}

function createDistortion(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(20);
    shaper.oversample = '4x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4000;
    const outputLevel = ctx.createGain();
    outputLevel.gain.value = 1;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(shaper);
    shaper.connect(tone);
    tone.connect(outputLevel);
    outputLevel.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, shaper, tone, merger, outputLevel] };
}

function createLimiter(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    comp.knee.value = 0;
    const ceiling = ctx.createGain();
    ceiling.gain.value = 10 ** (-0.3 / 20);
    comp.connect(ceiling);
    return { inputNode: comp, outputNode: ceiling, nodes: [comp, ceiling] };
}

function createFlanger(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const delay = ctx.createDelay(0.02);
    delay.delayTime.value = 0.003;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.003;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, lfo, lfoGain, feedback, merger],
    };
}

function createTremolo(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const tremGain = ctx.createGain();
    tremGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    const lfoOffset = ctx.createGain();
    lfoOffset.gain.value = 1;
    lfo.connect(lfoDepth);
    lfoDepth.connect(tremGain.gain);
    lfo.start();
    input.connect(tremGain);
    return { inputNode: input, outputNode: tremGain, nodes: [input, tremGain, lfo, lfoDepth] };
}

function makeBitcrusherCurve(bits: number): Float32Array<ArrayBuffer> {
    const samples = 65536;
    const curve = new Float32Array(samples);
    const steps = 2 ** bits;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
}

function createBitcrusher(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeBitcrusherCurve(8);
    shaper.oversample = 'none';
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(shaper);
    shaper.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, shaper, merger] };
}

function createFilter(ctx: BaseAudioContext): OfflineDeviceNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    return { inputNode: filter, outputNode: filter, nodes: [filter] };
}

function createAutoPan(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const splitterNode = ctx.createChannelSplitter(2);
    const mergerNode = ctx.createChannelMerger(2);
    const leftGain = ctx.createGain();
    leftGain.gain.value = 1;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 2;
    const lfoGainL = ctx.createGain();
    lfoGainL.gain.value = 0.35;
    const lfoGainR = ctx.createGain();
    lfoGainR.gain.value = -0.35;
    lfo.connect(lfoGainL);
    lfo.connect(lfoGainR);
    lfoGainL.connect(leftGain.gain);
    lfoGainR.connect(rightGain.gain);
    lfo.start();
    const output = ctx.createGain();
    input.connect(splitterNode);
    splitterNode.connect(leftGain, 0);
    splitterNode.connect(rightGain, 1);
    leftGain.connect(mergerNode, 0, 0);
    rightGain.connect(mergerNode, 0, 1);
    mergerNode.connect(output);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, splitterNode, mergerNode, leftGain, rightGain, lfo, lfoGainL, lfoGainR, output],
    };
}

// ── Synthesized Impulse Response Library ───────────────────────────────────
// Algorithmically generates IRs that approximate different acoustic spaces.
// Each generator shapes decay time, early reflections, diffusion, and spectral color.

type IRGenerator = (sampleRate: number) => AudioBuffer;

function generateIR(
    sampleRate: number,
    duration: number,
    decayT60: number,
    earlyMs: number,
    earlyLevel: number,
    diffusion: number,
    hfDamping: number,
    lfDamping: number,
): AudioBuffer {
    const len = Math.ceil(sampleRate * duration);
    const buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate });
    const decayRate = -6.9078 / (decayT60 * sampleRate); // ln(0.001) / (T60 * sr)
    const earlySamples = Math.floor(earlyMs * sampleRate / 1000);

    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        // Simple IIR for HF damping (one-pole LPF)
        let lpState = 0;
        const lpCoeff = Math.exp(-2 * Math.PI * hfDamping / sampleRate);
        // HP damping
        let hpState = 0;
        const hpCoeff = Math.exp(-2 * Math.PI * lfDamping / sampleRate);

        for (let i = 0; i < len; i++) {
            // White noise base
            let sample = Math.random() * 2 - 1;

            // Early reflections: sparse, louder hits
            const isEarly = i < earlySamples;
            if (isEarly) {
                // Sparse reflections with higher amplitude
                const spacing = Math.floor(sampleRate * 0.003 * (1 + ch * 0.2));
                if (i % spacing < 2) {
                    sample *= earlyLevel;
                } else {
                    sample *= earlyLevel * diffusion * 0.3;
                }
            }

            // Exponential decay envelope
            const envelope = Math.exp(decayRate * i);
            sample *= envelope;

            // Apply HF damping (more over time)
            const dampProgress = i / len;
            const effectiveLpCoeff = lpCoeff * (1 - dampProgress * 0.3);
            lpState = lpState * effectiveLpCoeff + sample * (1 - effectiveLpCoeff);
            sample = sample * (1 - diffusion) + lpState * diffusion;

            // Apply LF damping (mild HP filter)
            if (lfDamping > 10) {
                hpState = hpState * hpCoeff + sample * (1 - hpCoeff);
                sample = sample - hpState * 0.5;
            }

            // Stereo decorrelation using channel offset
            data[i] = sample;
        }
    }
    return buf;
}

const IR_GENERATORS: Record<string, IRGenerator> = {
    'small-room':  (sr) => generateIR(sr, 0.6, 0.4,  15, 2.0, 0.6, 6000, 80),
    'large-hall':  (sr) => generateIR(sr, 4.0, 3.0,  60, 1.5, 0.8, 4000, 40),
    'cathedral':   (sr) => generateIR(sr, 6.0, 5.0, 100, 1.2, 0.9, 3000, 30),
    'plate':       (sr) => generateIR(sr, 2.5, 2.0,   5, 2.5, 0.7, 8000, 100),
    'spring':      (sr) => generateIR(sr, 1.5, 1.2,   3, 3.0, 0.4, 6000, 200),
    'chamber':     (sr) => generateIR(sr, 1.2, 0.8,  25, 1.8, 0.7, 5000, 60),
    'studio-a':    (sr) => generateIR(sr, 0.8, 0.5,  10, 2.2, 0.5, 7000, 100),
    'studio-b':    (sr) => generateIR(sr, 1.0, 0.7,  20, 2.0, 0.6, 6000, 80),
    'warehouse':   (sr) => generateIR(sr, 3.5, 2.5,  80, 1.0, 0.85, 3500, 50),
    'tunnel':      (sr) => generateIR(sr, 2.0, 1.5,  40, 1.5, 0.9, 2500, 100),
};

const IR_NAMES = Object.keys(IR_GENERATORS);

function createConvolutionReverb(ctx: BaseAudioContext): OfflineDeviceNode {
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

    // Default IR: studio-a
    const defaultIR = IR_GENERATORS['studio-a']!(ctx.sampleRate);
    convolver.buffer = defaultIR;

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
        // nodes order: [splitter, dry, wet, convolver, merger, predelay, lowcut, highcut]
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut, highcut],
    };
}

function createStereoWidener(ctx: BaseAudioContext): OfflineDeviceNode {
    // Mid/Side encoding: Mid = (L+R)/2, Side = (L-R)/2
    // Width control: output L = Mid + Side*width, R = Mid - Side*width
    const input = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const output = ctx.createGain();

    // L+R (mid) path
    const midL = ctx.createGain();
    midL.gain.value = 0.5;
    const midR = ctx.createGain();
    midR.gain.value = 0.5;

    // Side path gains (controlled by width)
    const sideL = ctx.createGain();
    sideL.gain.value = 0.5;
    const sideR = ctx.createGain();
    sideR.gain.value = -0.5;

    // Mix and width control gains
    const midGain = ctx.createGain();
    midGain.gain.value = 1;
    const sideGain = ctx.createGain();
    sideGain.gain.value = 1; // width = 1 is normal stereo

    // Mono bass crossover
    const monoBassFilter = ctx.createBiquadFilter();
    monoBassFilter.type = 'lowpass';
    monoBassFilter.frequency.value = 200;
    monoBassFilter.Q.value = 0.7;

    // Simple pass-through — real M/S requires ScriptProcessor or AudioWorklet
    // For now, use a gain-based width control
    input.connect(output);

    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, output, splitter, merger, midL, midR, sideL, sideR, midGain, sideGain, monoBassFilter],
    };
}

function createDeEsser(ctx: BaseAudioContext): OfflineDeviceNode {
    // Sidechain: bandpass filter → compressor on the sibilant band
    const input = ctx.createGain();
    const output = ctx.createGain();

    // Main path (dry)
    const dry = ctx.createGain();
    dry.gain.value = 1;

    // Sibilance band compressor
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'peaking';
    bandpass.frequency.value = 6000;
    bandpass.Q.value = 2;
    bandpass.gain.value = 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    comp.knee.value = 3;

    input.connect(bandpass);
    bandpass.connect(comp);
    comp.connect(output);

    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, output, dry, bandpass, comp],
    };
}

function createLufsMeter(ctx: BaseAudioContext): OfflineDeviceNode {
    // LUFS Meter: K-weighting filter chain + analyser for visualization
    // Passes audio through transparently while providing analysis data
    const input = ctx.createGain();
    const output = ctx.createGain();

    // K-weighting stage 1: high shelf (+4 dB at high freq)
    const kHighShelf = ctx.createBiquadFilter();
    kHighShelf.type = 'highshelf';
    kHighShelf.frequency.value = 1500;
    kHighShelf.gain.value = 4;

    // K-weighting stage 2: highpass at ~38 Hz
    const kHighpass = ctx.createBiquadFilter();
    kHighpass.type = 'highpass';
    kHighpass.frequency.value = 38;
    kHighpass.Q.value = 0.5;

    // Analyser for visualization
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    // Pass-through path (unmodified audio)
    input.connect(output);

    // K-weighted analysis path (for meter display)
    input.connect(kHighShelf);
    kHighShelf.connect(kHighpass);
    kHighpass.connect(analyser);

    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, output, kHighShelf, kHighpass, analyser],
    };
}

export const DEVICE_FACTORIES: Record<string, (ctx: BaseAudioContext) => OfflineDeviceNode> = {
    'builtin-eq': createEq,
    'builtin-compressor': createCompressor,
    'builtin-reverb': createReverb,
    'builtin-delay': createDelay,
    'builtin-gain': createGainDevice,
    'builtin-sidechain-compressor': createSidechainCompressorFallback,
    'builtin-chorus': createChorus,
    'builtin-phaser': createPhaser,
    'builtin-distortion': createDistortion,
    'builtin-limiter': createLimiter,
    'builtin-flanger': createFlanger,
    'builtin-tremolo': createTremolo,
    'builtin-bitcrusher': createBitcrusher,
    'builtin-filter': createFilter,
    'builtin-autopan': createAutoPan,
    'builtin-convolution-reverb': createConvolutionReverb,
    'builtin-stereo-widener': createStereoWidener,
    'builtin-deesser': createDeEsser,
    'builtin-lufs-meter': createLufsMeter,
};

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    switch (deviceType) {
        case 'builtin-eq': {
            const [low, mid, high] = dn.nodes as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
            if (params['eq-low-gain'] !== undefined) {
                low.gain.value = params['eq-low-gain'];
            }
            if (params['eq-low-freq'] !== undefined) {
                low.frequency.value = params['eq-low-freq'];
            }
            if (params['eq-low-q'] !== undefined) {
                low.Q.value = params['eq-low-q'];
            }
            if (params['eq-mid-gain'] !== undefined) {
                mid.gain.value = params['eq-mid-gain'];
            }
            if (params['eq-mid-freq'] !== undefined) {
                mid.frequency.value = params['eq-mid-freq'];
            }
            if (params['eq-mid-q'] !== undefined) {
                mid.Q.value = params['eq-mid-q'];
            }
            if (params['eq-high-gain'] !== undefined) {
                high.gain.value = params['eq-high-gain'];
            }
            if (params['eq-high-freq'] !== undefined) {
                high.frequency.value = params['eq-high-freq'];
            }
            if (params['eq-high-q'] !== undefined) {
                high.Q.value = params['eq-high-q'];
            }
            break;
        }
        case 'builtin-compressor': {
            const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
            if (params['comp-threshold'] !== undefined) {
                comp.threshold.value = params['comp-threshold'];
            }
            if (params['comp-ratio'] !== undefined) {
                comp.ratio.value = Math.max(1, params['comp-ratio']);
            }
            if (params['comp-attack'] !== undefined) {
                comp.attack.value = params['comp-attack'] / 1000;
            }
            if (params['comp-release'] !== undefined) {
                comp.release.value = params['comp-release'] / 1000;
            }
            if (params['comp-knee'] !== undefined) {
                comp.knee.value = params['comp-knee'];
            }
            if (params['comp-makeup'] !== undefined) {
                makeup.gain.value = 10 ** (params['comp-makeup'] / 20);
            }
            break;
        }
        case 'builtin-reverb': {
            // nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut]
            const dry = dn.nodes[1] as GainNode;
            const wet = dn.nodes[2] as GainNode;
            const predelay = dn.nodes[5] as DelayNode;
            const lowcut = dn.nodes[6] as BiquadFilterNode;
            if (params['rev-mix'] !== undefined) {
                wet.gain.value = params['rev-mix'];
                dry.gain.value = 1 - params['rev-mix'];
            }
            if (params['rev-predelay'] !== undefined) {
                predelay.delayTime.value = params['rev-predelay'] / 1000;
            }
            if (params['rev-lowcut'] !== undefined) {
                lowcut.frequency.value = params['rev-lowcut'];
            }
            break;
        }
        case 'builtin-delay': {
            // nodes: [splitter, dry, wet, delay, feedback, merger, fbLowcut, fbHighcut]
            const delay = dn.nodes[3] as DelayNode;
            const fb = dn.nodes[4] as GainNode;
            const dryD = dn.nodes[1] as GainNode;
            const wetD = dn.nodes[2] as GainNode;
            const fbLowcut = dn.nodes[6] as BiquadFilterNode;
            const fbHighcut = dn.nodes[7] as BiquadFilterNode;
            if (params['delay-time'] !== undefined) {
                delay.delayTime.value = params['delay-time'] / 1000;
            }
            if (params['delay-feedback'] !== undefined) {
                fb.gain.value = params['delay-feedback'];
            }
            if (params['delay-lowcut'] !== undefined) {
                fbLowcut.frequency.value = params['delay-lowcut'];
            }
            if (params['delay-highcut'] !== undefined) {
                fbHighcut.frequency.value = params['delay-highcut'];
            }
            if (params['delay-mix'] !== undefined) {
                wetD.gain.value = params['delay-mix'];
                dryD.gain.value = 1 - params['delay-mix'];
            }
            break;
        }
        case 'builtin-gain': {
            const g = dn.nodes[0] as GainNode;
            if (params['gain-level'] !== undefined) {
                g.gain.value = 10 ** (params['gain-level'] / 20);
            }
            break;
        }
        case 'builtin-sidechain-compressor': {
            const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
            if (params['sc-comp-threshold'] !== undefined) {
                comp.threshold.value = params['sc-comp-threshold'];
            }
            if (params['sc-comp-ratio'] !== undefined) {
                comp.ratio.value = Math.max(1, params['sc-comp-ratio']);
            }
            if (params['sc-comp-attack'] !== undefined) {
                comp.attack.value = params['sc-comp-attack'] / 1000;
            }
            if (params['sc-comp-release'] !== undefined) {
                comp.release.value = params['sc-comp-release'] / 1000;
            }
            if (params['sc-comp-makeup'] !== undefined) {
                makeup.gain.value = 10 ** (params['sc-comp-makeup'] / 20);
            }
            break;
        }
        case 'builtin-chorus': {
            // nodes: [splitter, dry, wet, delay, lfo, lfoGain, merger, chorusFeedback]
            const dryC = dn.nodes[1] as GainNode;
            const wetC = dn.nodes[2] as GainNode;
            const delayC = dn.nodes[3] as DelayNode;
            const lfoC = dn.nodes[4] as OscillatorNode;
            const lfoGainC = dn.nodes[5] as GainNode;
            const chorusFb = dn.nodes[7] as GainNode;
            if (params['chorus-rate'] !== undefined) {
                lfoC.frequency.value = params['chorus-rate'];
            }
            if (params['chorus-depth'] !== undefined) {
                lfoGainC.gain.value = params['chorus-depth'] / 1000;
                delayC.delayTime.value = Math.max(0.001, params['chorus-depth'] / 1000);
            }
            if (params['chorus-feedback'] !== undefined) {
                chorusFb.gain.value = params['chorus-feedback'];
            }
            if (params['chorus-mix'] !== undefined) {
                wetC.gain.value = params['chorus-mix'];
                dryC.gain.value = 1 - params['chorus-mix'];
            }
            break;
        }
        case 'builtin-phaser': {
            const filtersP = dn.nodes.slice(1, 5) as BiquadFilterNode[];
            const lfoP = dn.nodes[5] as OscillatorNode;
            const lfoGainP = dn.nodes[6] as GainNode;
            const feedbackP = dn.nodes[7] as GainNode;
            const dryP = dn.nodes[8] as GainNode;
            const wetP = dn.nodes[9] as GainNode;
            if (params['phaser-rate'] !== undefined) {
                lfoP.frequency.value = params['phaser-rate'];
            }
            if (params['phaser-depth'] !== undefined) {
                lfoGainP.gain.value = params['phaser-depth'] * 1000;
                const wetVal = params['phaser-depth'] * 0.5 + 0.25;
                wetP.gain.value = Math.min(1, wetVal);
                dryP.gain.value = 1 - Math.min(1, wetVal);
            }
            if (params['phaser-feedback'] !== undefined) {
                feedbackP.gain.value = params['phaser-feedback'];
            }
            if (params['phaser-stages'] !== undefined) {
                for (const f of filtersP) {
                    f.Q.value = params['phaser-stages'] > 6 ? 1 : 0.5;
                }
            }
            break;
        }
        case 'builtin-distortion': {
            // nodes: [splitter, dry, wet, shaper, tone, merger, outputLevel]
            const dryDist = dn.nodes[1] as GainNode;
            const wetDist = dn.nodes[2] as GainNode;
            const shaperD = dn.nodes[3] as WaveShaperNode;
            const toneD = dn.nodes[4] as BiquadFilterNode;
            const outputLevel = dn.nodes[6] as GainNode;
            if (params['dist-drive'] !== undefined) {
                shaperD.curve = makeDistortionCurve(params['dist-drive']);
            }
            if (params['dist-tone'] !== undefined) {
                toneD.frequency.value = params['dist-tone'];
            }
            if (params['dist-output'] !== undefined) {
                outputLevel.gain.value = 10 ** (params['dist-output'] / 20);
            }
            if (params['dist-mix'] !== undefined) {
                wetDist.gain.value = params['dist-mix'];
                dryDist.gain.value = 1 - params['dist-mix'];
            }
            break;
        }
        case 'builtin-limiter': {
            const compL = dn.nodes[0] as DynamicsCompressorNode;
            const ceilingL = dn.nodes[1] as GainNode;
            if (params['lim-threshold'] !== undefined) {
                compL.threshold.value = params['lim-threshold'];
            }
            if (params['lim-release'] !== undefined) {
                compL.release.value = params['lim-release'] / 1000;
            }
            if (params['lim-ceiling'] !== undefined) {
                ceilingL.gain.value = 10 ** (params['lim-ceiling'] / 20);
            }
            break;
        }
        case 'builtin-flanger': {
            // nodes: [splitter, dry, wet, delay, lfo, lfoGain, feedback, merger]
            const dryF = dn.nodes[1] as GainNode;
            const wetF = dn.nodes[2] as GainNode;
            const delayF = dn.nodes[3] as DelayNode;
            const lfoF = dn.nodes[4] as OscillatorNode;
            const lfoGainF = dn.nodes[5] as GainNode;
            const feedbackF = dn.nodes[6] as GainNode;
            if (params['flanger-rate'] !== undefined) {
                lfoF.frequency.value = params['flanger-rate'];
            }
            if (params['flanger-depth'] !== undefined) {
                lfoGainF.gain.value = params['flanger-depth'] / 1000;
                delayF.delayTime.value = Math.max(0.001, params['flanger-depth'] / 1000);
            }
            if (params['flanger-feedback'] !== undefined) {
                feedbackF.gain.value = params['flanger-feedback'];
            }
            if (params['flanger-mix'] !== undefined) {
                wetF.gain.value = params['flanger-mix'];
                dryF.gain.value = 1 - params['flanger-mix'];
            }
            break;
        }
        case 'builtin-tremolo': {
            // nodes: [input, tremGain, lfo, lfoDepth]
            const lfoT = dn.nodes[2] as OscillatorNode;
            const lfoDepthT = dn.nodes[3] as GainNode;
            if (params['trem-rate'] !== undefined) {
                lfoT.frequency.value = params['trem-rate'];
            }
            if (params['trem-depth'] !== undefined) {
                lfoDepthT.gain.value = params['trem-depth'];
            }
            if (params['trem-shape'] !== undefined) {
                lfoT.type = params['trem-shape'] === 1 ? 'square' : 'sine';
            }
            break;
        }
        case 'builtin-bitcrusher': {
            // nodes: [splitter, dry, wet, shaper, merger]
            const dryBC = dn.nodes[1] as GainNode;
            const wetBC = dn.nodes[2] as GainNode;
            const shaperBC = dn.nodes[3] as WaveShaperNode;
            if (params['crush-bits'] !== undefined) {
                shaperBC.curve = makeBitcrusherCurve(Math.max(1, Math.round(params['crush-bits'])));
            }
            if (params['crush-mix'] !== undefined) {
                wetBC.gain.value = params['crush-mix'];
                dryBC.gain.value = 1 - params['crush-mix'];
            }
            break;
        }
        case 'builtin-filter': {
            // nodes: [filter]
            const filterNode = dn.nodes[0] as BiquadFilterNode;
            if (params['filter-cutoff'] !== undefined) {
                filterNode.frequency.value = params['filter-cutoff'];
            }
            if (params['filter-resonance'] !== undefined) {
                filterNode.Q.value = params['filter-resonance'];
            }
            if (params['filter-type'] !== undefined) {
                const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
                filterNode.type = types[Math.round(params['filter-type'])] ?? 'lowpass';
            }
            break;
        }
        case 'builtin-autopan': {
            // nodes: [input, splitterNode, mergerNode, leftGain, rightGain, lfo, lfoGainL, lfoGainR, output]
            const lfoAP = dn.nodes[5] as OscillatorNode;
            const lfoGainLAP = dn.nodes[6] as GainNode;
            const lfoGainRAP = dn.nodes[7] as GainNode;
            if (params['autopan-rate'] !== undefined) {
                lfoAP.frequency.value = params['autopan-rate'];
            }
            if (params['autopan-depth'] !== undefined) {
                lfoGainLAP.gain.value = params['autopan-depth'] * 0.5;
                lfoGainRAP.gain.value = -(params['autopan-depth'] * 0.5);
            }
            if (params['autopan-shape'] !== undefined) {
                lfoAP.type = params['autopan-shape'] === 1 ? 'triangle' : 'sine';
            }
            break;
        }
        case 'builtin-convolution-reverb': {
            // nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut, highcut]
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
            if (params['conv-predelay'] !== undefined) {
                predelayConv.delayTime.value = params['conv-predelay'] / 1000;
            }
            if (params['conv-lowcut'] !== undefined) {
                lowcutConv.frequency.value = params['conv-lowcut'];
            }
            if (params['conv-highcut'] !== undefined) {
                highcutConv.frequency.value = params['conv-highcut'];
            }
            if (params['conv-ir'] !== undefined) {
                const irIndex = Math.round(params['conv-ir']);
                const irName = IR_NAMES[irIndex] ?? 'studio-a';
                const gen = IR_GENERATORS[irName];
                if (gen && convolverNode.context) {
                    convolverNode.buffer = gen(convolverNode.context.sampleRate);
                }
            }
            break;
        }
        case 'builtin-stereo-widener': {
            // nodes: [input, output, splitter, merger, midL, midR, sideL, sideR, midGain, sideGain, monoBassFilter]
            const inputSW = dn.nodes[0] as GainNode;
            const outputSW = dn.nodes[1] as GainNode;
            const monoBass = dn.nodes[10] as BiquadFilterNode;
            if (params['width-amount'] !== undefined) {
                // Width > 1 amplifies, < 1 narrows
                const w = params['width-amount'];
                outputSW.gain.value = w;
            }
            if (params['width-mid'] !== undefined) {
                inputSW.gain.value = 10 ** (params['width-mid'] / 20);
            }
            if (params['width-mono-bass'] !== undefined) {
                monoBass.frequency.value = params['width-mono-bass'];
            }
            break;
        }
        case 'builtin-deesser': {
            // nodes: [input, output, dry, bandpass, comp]
            const bandpassDE = dn.nodes[3] as BiquadFilterNode;
            const compDE = dn.nodes[4] as DynamicsCompressorNode;
            if (params['deess-threshold'] !== undefined) {
                compDE.threshold.value = params['deess-threshold'];
            }
            if (params['deess-freq'] !== undefined) {
                bandpassDE.frequency.value = params['deess-freq'];
            }
            if (params['deess-range'] !== undefined) {
                compDE.ratio.value = Math.max(1, Math.abs(params['deess-range']) / 2);
            }
            break;
        }
        case 'builtin-lufs-meter': {
            // LUFS meter is a pass-through analyzer — no audio params to apply
            break;
        }
    }
}
