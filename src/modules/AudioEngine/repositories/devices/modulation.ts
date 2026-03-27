import { type OfflineDeviceNode } from './types';

// ── Chorus ───────────────────────────────────────────────────────────────

export function createChorus(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const delay1 = ctx.createDelay(0.05);
    delay1.delayTime.value = 0.02;
    const delay2 = ctx.createDelay(0.05);
    delay2.delayTime.value = 0.025;
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.5;
    lfo1.type = 'sine';
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.6;
    lfo2.type = 'sine';
    const lfoGain1 = ctx.createGain();
    lfoGain1.gain.value = 0.005;
    const lfoGain2 = ctx.createGain();
    lfoGain2.gain.value = 0.005;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay1);
    splitter.connect(delay2);
    lfo1.connect(lfoGain1);
    lfoGain1.connect(delay1.delayTime as unknown as AudioNode);
    lfo2.connect(lfoGain2);
    lfoGain2.connect(delay2.delayTime as unknown as AudioNode);
    delay1.connect(wet);
    delay2.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo1.start(0);
    lfo2.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay1, delay2, lfo1, lfo2, lfoGain1, lfoGain2, merger],
    };
}

export function applyChorusParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dry = dn.nodes[1] as GainNode;
    const wet = dn.nodes[2] as GainNode;
    const lfo1 = dn.nodes[5] as OscillatorNode;
    const lfoGain = dn.nodes[7] as GainNode;
    if (params['chorus-rate'] !== undefined) { lfo1.frequency.value = params['chorus-rate']; }
    if (params['chorus-depth'] !== undefined) { lfoGain.gain.value = params['chorus-depth'] / 1000; }
    if (params['chorus-mix'] !== undefined) {
        wet.gain.value = params['chorus-mix'];
        dry.gain.value = 1 - params['chorus-mix'];
    }
}

// ── Phaser ───────────────────────────────────────────────────────────────

export function createPhaser(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const stages = 4;
    const filters: BiquadFilterNode[] = [];
    for (let i = 0; i < stages; i++) {
        const f = ctx.createBiquadFilter();
        f.type = 'allpass';
        f.frequency.value = 1000 * (i + 1);
        f.Q.value = 0.5;
        filters.push(f);
    }
    for (let i = 0; i < filters.length - 1; i++) {
        filters[i]!.connect(filters[i + 1]!);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.5;
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(filters[0]!);
    lfo.connect(lfoGain);
    for (const f of filters) {
        lfoGain.connect(f.frequency as unknown as AudioNode);
    }
    const lastFilter = filters[filters.length - 1]!;
    lastFilter.connect(feedback);
    feedback.connect(filters[0]!);
    lastFilter.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, ...filters, lfo, lfoGain, feedback, dry, wet],
    };
}

export function applyPhaserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    // nodes: [splitter, dry, wet, f0, f1, f2, f3, lfo, lfoGain, feedback, dry, wet]
    const filtersP = [dn.nodes[3], dn.nodes[4], dn.nodes[5], dn.nodes[6]] as BiquadFilterNode[];
    const lfoP = dn.nodes[7] as OscillatorNode;
    const lfoGainP = dn.nodes[8] as GainNode;
    const feedbackP = dn.nodes[9] as GainNode;
    const dryP = dn.nodes[1] as GainNode;
    const wetP = dn.nodes[2] as GainNode;
    if (params['phaser-rate'] !== undefined) { lfoP.frequency.value = params['phaser-rate']; }
    if (params['phaser-depth'] !== undefined) {
        lfoGainP.gain.value = params['phaser-depth'] * 1000;
        const wetVal = params['phaser-depth'] * 0.5 + 0.25;
        wetP.gain.value = Math.min(1, wetVal);
        dryP.gain.value = 1 - Math.min(1, wetVal);
    }
    if (params['phaser-feedback'] !== undefined) { feedbackP.gain.value = params['phaser-feedback']; }
    if (params['phaser-stages'] !== undefined) {
        for (const f of filtersP) { f.Q.value = params['phaser-stages']! > 6 ? 1 : 0.5; }
    }
}

// ── Flanger ──────────────────────────────────────────────────────────────

export function createFlanger(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const delay = ctx.createDelay(0.02);
    delay.delayTime.value = 0.005;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.5;
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.003;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime as unknown as AudioNode);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, lfo, lfoGain, feedback, merger],
    };
}

export function applyFlangerParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryF = dn.nodes[1] as GainNode;
    const wetF = dn.nodes[2] as GainNode;
    const delayF = dn.nodes[3] as DelayNode;
    const lfoF = dn.nodes[4] as OscillatorNode;
    const lfoGainF = dn.nodes[5] as GainNode;
    const feedbackF = dn.nodes[6] as GainNode;
    if (params['flanger-rate'] !== undefined) { lfoF.frequency.value = params['flanger-rate']; }
    if (params['flanger-depth'] !== undefined) {
        lfoGainF.gain.value = params['flanger-depth'] / 1000;
        delayF.delayTime.value = Math.max(0.001, params['flanger-depth'] / 1000);
    }
    if (params['flanger-feedback'] !== undefined) { feedbackF.gain.value = params['flanger-feedback']; }
    if (params['flanger-mix'] !== undefined) {
        wetF.gain.value = params['flanger-mix'];
        dryF.gain.value = 1 - params['flanger-mix'];
    }
}

// ── Tremolo ──────────────────────────────────────────────────────────────

export function createTremolo(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const tremGain = ctx.createGain();
    tremGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    input.connect(tremGain);
    lfo.connect(lfoDepth);
    lfoDepth.connect(tremGain.gain as unknown as AudioNode);
    lfo.start(0);
    return { inputNode: input, outputNode: tremGain, nodes: [input, tremGain, lfo, lfoDepth] };
}

export function applyTremoloParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const lfoT = dn.nodes[2] as OscillatorNode;
    const lfoDepthT = dn.nodes[3] as GainNode;
    if (params['trem-rate'] !== undefined) { lfoT.frequency.value = params['trem-rate']; }
    if (params['trem-depth'] !== undefined) { lfoDepthT.gain.value = params['trem-depth']; }
    if (params['trem-shape'] !== undefined) { lfoT.type = params['trem-shape'] === 1 ? 'square' : 'sine'; }
}

// ── AutoPan ──────────────────────────────────────────────────────────────

export function createAutoPan(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const splitterNode = ctx.createChannelSplitter(2);
    const mergerNode = ctx.createChannelMerger(2);
    const leftGain = ctx.createGain();
    leftGain.gain.value = 1;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1;
    lfo.type = 'sine';
    const lfoGainL = ctx.createGain();
    lfoGainL.gain.value = 0.5;
    const lfoGainR = ctx.createGain();
    lfoGainR.gain.value = -0.5;
    const output = ctx.createGain();
    output.gain.value = 1;
    input.connect(splitterNode);
    splitterNode.connect(leftGain, 0);
    splitterNode.connect(rightGain, 1);
    lfo.connect(lfoGainL);
    lfo.connect(lfoGainR);
    lfoGainL.connect(leftGain.gain as unknown as AudioNode);
    lfoGainR.connect(rightGain.gain as unknown as AudioNode);
    leftGain.connect(mergerNode, 0, 0);
    rightGain.connect(mergerNode, 0, 1);
    mergerNode.connect(output);
    lfo.start(0);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, splitterNode, mergerNode, leftGain, rightGain, lfo, lfoGainL, lfoGainR, output],
    };
}

export function applyAutoPanParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const lfoAP = dn.nodes[5] as OscillatorNode;
    const lfoGainLAP = dn.nodes[6] as GainNode;
    const lfoGainRAP = dn.nodes[7] as GainNode;
    if (params['autopan-rate'] !== undefined) { lfoAP.frequency.value = params['autopan-rate']; }
    if (params['autopan-depth'] !== undefined) {
        lfoGainLAP.gain.value = params['autopan-depth'] * 0.5;
        lfoGainRAP.gain.value = -(params['autopan-depth'] * 0.5);
    }
    if (params['autopan-shape'] !== undefined) { lfoAP.type = params['autopan-shape'] === 1 ? 'triangle' : 'sine'; }
}

// ── Stereo Widener ───────────────────────────────────────────────────────

export function createStereoWidener(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const midL = ctx.createGain();
    const midR = ctx.createGain();
    const sideL = ctx.createGain();
    const sideR = ctx.createGain();
    const midGain = ctx.createGain();
    midGain.gain.value = 1;
    const sideGain = ctx.createGain();
    sideGain.gain.value = 1;
    const monoBassFilter = ctx.createBiquadFilter();
    monoBassFilter.type = 'lowpass';
    monoBassFilter.frequency.value = 200;
    input.connect(splitter);
    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    midL.connect(midGain);
    midR.connect(midGain);
    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);
    sideL.connect(sideGain);
    sideR.connect(sideGain);
    midGain.connect(merger, 0, 0);
    midGain.connect(merger, 0, 1);
    merger.connect(output);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, output, splitter, merger, midL, midR, sideL, sideR, midGain, sideGain, monoBassFilter],
    };
}

export function applyStereoWidenerParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const inputSW = dn.nodes[0] as GainNode;
    const outputSW = dn.nodes[1] as GainNode;
    const monoBass = dn.nodes[10] as BiquadFilterNode;
    if (params['width-amount'] !== undefined) { outputSW.gain.value = params['width-amount']; }
    if (params['width-mid'] !== undefined) { inputSW.gain.value = 10 ** (params['width-mid'] / 20); }
    if (params['width-mono-bass'] !== undefined) { monoBass.frequency.value = params['width-mono-bass']; }
}
