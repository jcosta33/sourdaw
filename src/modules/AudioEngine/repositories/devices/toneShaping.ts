import { type OfflineDeviceNode } from './types';

// ── Gain ─────────────────────────────────────────────────────────────────

export function createGainDevice(ctx: BaseAudioContext): OfflineDeviceNode {
    const g = ctx.createGain();
    g.gain.value = 1;
    return { inputNode: g, outputNode: g, nodes: [g] };
}

export function applyGainParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const g = dn.nodes[0] as GainNode;
    if (params['gain-level'] !== undefined) { g.gain.value = 10 ** (params['gain-level'] / 20); }
}

// ── Filter ───────────────────────────────────────────────────────────────

export function createFilter(ctx: BaseAudioContext): OfflineDeviceNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    return { inputNode: filter, outputNode: filter, nodes: [filter] };
}

export function applyFilterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const filterNode = dn.nodes[0] as BiquadFilterNode;
    if (params['filter-cutoff'] !== undefined) { filterNode.frequency.value = params['filter-cutoff']; }
    if (params['filter-resonance'] !== undefined) { filterNode.Q.value = params['filter-resonance']; }
    if (params['filter-type'] !== undefined) {
        const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
        filterNode.type = types[Math.round(params['filter-type'])] ?? 'lowpass';
    }
}

// ── Distortion ───────────────────────────────────────────────────────────

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

export function createDistortion(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applyDistortionParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryDist = dn.nodes[1] as GainNode;
    const wetDist = dn.nodes[2] as GainNode;
    const shaperD = dn.nodes[3] as WaveShaperNode;
    const toneD = dn.nodes[4] as BiquadFilterNode;
    const outputLevel = dn.nodes[6] as GainNode;
    if (params['dist-drive'] !== undefined) { shaperD.curve = makeDistortionCurve(params['dist-drive']); }
    if (params['dist-tone'] !== undefined) { toneD.frequency.value = params['dist-tone']; }
    if (params['dist-output'] !== undefined) { outputLevel.gain.value = 10 ** (params['dist-output'] / 20); }
    if (params['dist-mix'] !== undefined) {
        wetDist.gain.value = params['dist-mix'];
        dryDist.gain.value = 1 - params['dist-mix'];
    }
}

// ── Bitcrusher ───────────────────────────────────────────────────────────

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

export function createBitcrusher(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applyBitcrusherParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryBC = dn.nodes[1] as GainNode;
    const wetBC = dn.nodes[2] as GainNode;
    const shaperBC = dn.nodes[3] as WaveShaperNode;
    if (params['crush-bits'] !== undefined) { shaperBC.curve = makeBitcrusherCurve(Math.max(1, Math.round(params['crush-bits']))); }
    if (params['crush-mix'] !== undefined) {
        wetBC.gain.value = params['crush-mix'];
        dryBC.gain.value = 1 - params['crush-mix'];
    }
}

// ── De-esser ─────────────────────────────────────────────────────────────

export function createDeEsser(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;
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
    return { inputNode: input, outputNode: output, nodes: [input, output, dry, bandpass, comp] };
}

export function applyDeEsserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const bandpassDE = dn.nodes[3] as BiquadFilterNode;
    const compDE = dn.nodes[4] as DynamicsCompressorNode;
    if (params['deess-threshold'] !== undefined) { compDE.threshold.value = params['deess-threshold']; }
    if (params['deess-freq'] !== undefined) { bandpassDE.frequency.value = params['deess-freq']; }
    if (params['deess-range'] !== undefined) { compDE.ratio.value = Math.max(1, Math.abs(params['deess-range']) / 2); }
}

// ── LUFS Meter ───────────────────────────────────────────────────────────

export function createLufsMeter(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const kHighShelf = ctx.createBiquadFilter();
    kHighShelf.type = 'highshelf';
    kHighShelf.frequency.value = 1500;
    kHighShelf.gain.value = 4;
    const kHighpass = ctx.createBiquadFilter();
    kHighpass.type = 'highpass';
    kHighpass.frequency.value = 38;
    kHighpass.Q.value = 0.5;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    input.connect(output);
    input.connect(kHighShelf);
    kHighShelf.connect(kHighpass);
    kHighpass.connect(analyser);
    return { inputNode: input, outputNode: output, nodes: [input, output, kHighShelf, kHighpass, analyser] };
}
