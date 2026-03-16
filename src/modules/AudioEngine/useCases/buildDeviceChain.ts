import type { Device } from "#/modules/Track/models/Track";

export type OfflineDeviceNode = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    nodes: AudioNode[];
};

const createEq = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 100;
    low.gain.value = 0;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 1;
    mid.gain.value = 0;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 8000;
    high.gain.value = 0;
    low.connect(mid);
    mid.connect(high);
    return { inputNode: low, outputNode: high, nodes: [low, mid, high] };
};

const createCompressor = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup);
    return { inputNode: comp, outputNode: makeup, nodes: [comp, makeup] };
};

const createReverb = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
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
    splitter.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, convolver, merger] };
};

const createDelay = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const delay = ctx.createDelay(5);
    delay.delayTime.value = 0.25;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const splitter = ctx.createGain();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, delay, feedback, merger] };
};

const createGainDevice = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const g = ctx.createGain();
    g.gain.value = 1;
    return { inputNode: g, outputNode: g, nodes: [g] };
};

const createSidechainCompressorFallback = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup);
    return { inputNode: comp, outputNode: makeup, nodes: [comp, makeup] };
};

const createChorus = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.007;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 1.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.005;
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, delay, lfo, lfoGain, merger] };
};

const createPhaser = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const stageCount = 4;
    const filters: BiquadFilterNode[] = [];
    for (let i = 0; i < stageCount; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = "allpass";
        ap.frequency.value = 1000;
        ap.Q.value = 0.5;
        filters.push(ap);
    }
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
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
    return { inputNode: input, outputNode: output, nodes: [input, ...filters, lfo, lfoGain, feedbackGain, dry, wet, output] };
};

const makeDistortionCurve = (drive: number): Float32Array<ArrayBuffer> => {
    const samples = 44100;
    const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
    const k = Math.max(0.1, drive);
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.tanh(k * x);
    }
    return curve;
};

const createDistortion = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(20);
    shaper.oversample = "4x";
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 4000;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(shaper);
    shaper.connect(tone);
    tone.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, shaper, tone, merger] };
};

const createLimiter = (ctx: BaseAudioContext): OfflineDeviceNode => {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    comp.knee.value = 0;
    const ceiling = ctx.createGain();
    ceiling.gain.value = Math.pow(10, -0.3 / 20);
    comp.connect(ceiling);
    return { inputNode: comp, outputNode: ceiling, nodes: [comp, ceiling] };
};

const DEVICE_FACTORIES: Record<string, (ctx: BaseAudioContext) => OfflineDeviceNode> = {
    "builtin-eq": createEq,
    "builtin-compressor": createCompressor,
    "builtin-reverb": createReverb,
    "builtin-delay": createDelay,
    "builtin-gain": createGainDevice,
    "builtin-sidechain-compressor": createSidechainCompressorFallback,
    "builtin-chorus": createChorus,
    "builtin-phaser": createPhaser,
    "builtin-distortion": createDistortion,
    "builtin-limiter": createLimiter,
};

const applyParams = (dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void => {
    switch (deviceType) {
        case "builtin-eq": {
            const [low, mid, high] = dn.nodes as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
            if (params["eq-low-gain"] !== undefined) { low.gain.value = params["eq-low-gain"]; }
            if (params["eq-low-freq"] !== undefined) { low.frequency.value = params["eq-low-freq"]; }
            if (params["eq-mid-gain"] !== undefined) { mid.gain.value = params["eq-mid-gain"]; }
            if (params["eq-mid-freq"] !== undefined) { mid.frequency.value = params["eq-mid-freq"]; }
            if (params["eq-mid-q"] !== undefined) { mid.Q.value = params["eq-mid-q"]; }
            if (params["eq-high-gain"] !== undefined) { high.gain.value = params["eq-high-gain"]; }
            if (params["eq-high-freq"] !== undefined) { high.frequency.value = params["eq-high-freq"]; }
            break;
        }
        case "builtin-compressor": {
            const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
            if (params["comp-threshold"] !== undefined) { comp.threshold.value = params["comp-threshold"]; }
            if (params["comp-ratio"] !== undefined) { comp.ratio.value = Math.max(1, params["comp-ratio"]); }
            if (params["comp-attack"] !== undefined) { comp.attack.value = params["comp-attack"] / 1000; }
            if (params["comp-release"] !== undefined) { comp.release.value = params["comp-release"] / 1000; }
            if (params["comp-makeup"] !== undefined) { makeup.gain.value = Math.pow(10, params["comp-makeup"] / 20); }
            break;
        }
        case "builtin-reverb": {
            const wet = dn.nodes[2] as GainNode;
            const dry = dn.nodes[1] as GainNode;
            if (params["rev-mix"] !== undefined) {
                wet.gain.value = params["rev-mix"];
                dry.gain.value = 1 - params["rev-mix"];
            }
            break;
        }
        case "builtin-delay": {
            const delay = dn.nodes[3] as DelayNode;
            const fb = dn.nodes[4] as GainNode;
            const dryD = dn.nodes[1] as GainNode;
            const wetD = dn.nodes[2] as GainNode;
            if (params["delay-time"] !== undefined) { delay.delayTime.value = params["delay-time"] / 1000; }
            if (params["delay-feedback"] !== undefined) { fb.gain.value = params["delay-feedback"]; }
            if (params["delay-mix"] !== undefined) {
                wetD.gain.value = params["delay-mix"];
                dryD.gain.value = 1 - params["delay-mix"];
            }
            break;
        }
        case "builtin-gain": {
            const g = dn.nodes[0] as GainNode;
            if (params["gain-level"] !== undefined) { g.gain.value = Math.pow(10, params["gain-level"] / 20); }
            break;
        }
        case "builtin-sidechain-compressor": {
            const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
            if (params["sc-comp-threshold"] !== undefined) { comp.threshold.value = params["sc-comp-threshold"]; }
            if (params["sc-comp-ratio"] !== undefined) { comp.ratio.value = Math.max(1, params["sc-comp-ratio"]); }
            if (params["sc-comp-attack"] !== undefined) { comp.attack.value = params["sc-comp-attack"] / 1000; }
            if (params["sc-comp-release"] !== undefined) { comp.release.value = params["sc-comp-release"] / 1000; }
            if (params["sc-comp-makeup"] !== undefined) { makeup.gain.value = Math.pow(10, params["sc-comp-makeup"] / 20); }
            break;
        }
        case "builtin-chorus": {
            const dryC = dn.nodes[1] as GainNode;
            const wetC = dn.nodes[2] as GainNode;
            const delayC = dn.nodes[3] as DelayNode;
            const lfoC = dn.nodes[4] as OscillatorNode;
            const lfoGainC = dn.nodes[5] as GainNode;
            if (params["chorus-rate"] !== undefined) { lfoC.frequency.value = params["chorus-rate"]; }
            if (params["chorus-depth"] !== undefined) {
                lfoGainC.gain.value = params["chorus-depth"] / 1000;
                delayC.delayTime.value = Math.max(0.001, params["chorus-depth"] / 1000);
            }
            if (params["chorus-mix"] !== undefined) {
                wetC.gain.value = params["chorus-mix"];
                dryC.gain.value = 1 - params["chorus-mix"];
            }
            break;
        }
        case "builtin-phaser": {
            const filtersP = dn.nodes.slice(1, 5) as BiquadFilterNode[];
            const lfoP = dn.nodes[5] as OscillatorNode;
            const lfoGainP = dn.nodes[6] as GainNode;
            const feedbackP = dn.nodes[7] as GainNode;
            const dryP = dn.nodes[8] as GainNode;
            const wetP = dn.nodes[9] as GainNode;
            if (params["phaser-rate"] !== undefined) { lfoP.frequency.value = params["phaser-rate"]; }
            if (params["phaser-depth"] !== undefined) {
                lfoGainP.gain.value = params["phaser-depth"] * 1000;
                const wetVal = params["phaser-depth"] * 0.5 + 0.25;
                wetP.gain.value = Math.min(1, wetVal);
                dryP.gain.value = 1 - Math.min(1, wetVal);
            }
            if (params["phaser-feedback"] !== undefined) { feedbackP.gain.value = params["phaser-feedback"]; }
            if (params["phaser-stages"] !== undefined) {
                for (const f of filtersP) {
                    f.Q.value = params["phaser-stages"] > 6 ? 1 : 0.5;
                }
            }
            break;
        }
        case "builtin-distortion": {
            const dryD = dn.nodes[1] as GainNode;
            const wetD = dn.nodes[2] as GainNode;
            const shaperD = dn.nodes[3] as WaveShaperNode;
            const toneD = dn.nodes[4] as BiquadFilterNode;
            if (params["dist-drive"] !== undefined) { shaperD.curve = makeDistortionCurve(params["dist-drive"]); }
            if (params["dist-tone"] !== undefined) { toneD.frequency.value = params["dist-tone"]; }
            if (params["dist-mix"] !== undefined) {
                wetD.gain.value = params["dist-mix"];
                dryD.gain.value = 1 - params["dist-mix"];
            }
            break;
        }
        case "builtin-limiter": {
            const compL = dn.nodes[0] as DynamicsCompressorNode;
            const ceilingL = dn.nodes[1] as GainNode;
            if (params["lim-threshold"] !== undefined) { compL.threshold.value = params["lim-threshold"]; }
            if (params["lim-release"] !== undefined) { compL.release.value = params["lim-release"] / 1000; }
            if (params["lim-ceiling"] !== undefined) { ceilingL.gain.value = Math.pow(10, params["lim-ceiling"] / 20); }
            break;
        }
    }
};

export type DeviceNodeEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
};

export const buildDeviceChain = (
    ctx: BaseAudioContext,
    devices: Device[],
    inputNode: AudioNode,
    outputNode: AudioNode,
): DeviceNodeEntry[] => {
    const activeDevices = devices.filter((d) => !d.bypassed);
    if (activeDevices.length === 0) {
        inputNode.connect(outputNode);
        return [];
    }

    const entries: DeviceNodeEntry[] = [];
    let prev: AudioNode = inputNode;
    for (const device of activeDevices) {
        const factory = DEVICE_FACTORIES[device.type];
        if (!factory) {
            continue;
        }
        const dn = factory(ctx);
        applyParams(dn, device.type, device.parameterValues);
        prev.connect(dn.inputNode);
        prev = dn.outputNode;
        entries.push({ deviceId: device.id, deviceType: device.type, node: dn });
    }
    prev.connect(outputNode);
    return entries;
};
