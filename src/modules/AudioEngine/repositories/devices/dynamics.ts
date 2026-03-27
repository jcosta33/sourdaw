import { type OfflineDeviceNode } from './types';

// ── EQ ──────────────────────────────────────────────────────────────────

export function createEq(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applyEqParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [low, mid, high] = dn.nodes as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
    if (params['eq-low-gain'] !== undefined) { low.gain.value = params['eq-low-gain']; }
    if (params['eq-low-freq'] !== undefined) { low.frequency.value = params['eq-low-freq']; }
    if (params['eq-low-q'] !== undefined) { low.Q.value = params['eq-low-q']; }
    if (params['eq-mid-gain'] !== undefined) { mid.gain.value = params['eq-mid-gain']; }
    if (params['eq-mid-freq'] !== undefined) { mid.frequency.value = params['eq-mid-freq']; }
    if (params['eq-mid-q'] !== undefined) { mid.Q.value = params['eq-mid-q']; }
    if (params['eq-high-gain'] !== undefined) { high.gain.value = params['eq-high-gain']; }
    if (params['eq-high-freq'] !== undefined) { high.frequency.value = params['eq-high-freq']; }
    if (params['eq-high-q'] !== undefined) { high.Q.value = params['eq-high-q']; }
}

// ── Compressor ───────────────────────────────────────────────────────────

export function createCompressor(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applyCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
    if (params['comp-threshold'] !== undefined) { comp.threshold.value = params['comp-threshold']; }
    if (params['comp-ratio'] !== undefined) { comp.ratio.value = Math.max(1, params['comp-ratio']); }
    if (params['comp-attack'] !== undefined) { comp.attack.value = params['comp-attack'] / 1000; }
    if (params['comp-release'] !== undefined) { comp.release.value = params['comp-release'] / 1000; }
    if (params['comp-knee'] !== undefined) { comp.knee.value = params['comp-knee']; }
    if (params['comp-makeup'] !== undefined) { makeup.gain.value = 10 ** (params['comp-makeup'] / 20); }
}

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applySidechainCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
    if (params['sc-comp-threshold'] !== undefined) { comp.threshold.value = params['sc-comp-threshold']; }
    if (params['sc-comp-ratio'] !== undefined) { comp.ratio.value = Math.max(1, params['sc-comp-ratio']); }
    if (params['sc-comp-attack'] !== undefined) { comp.attack.value = params['sc-comp-attack'] / 1000; }
    if (params['sc-comp-release'] !== undefined) { comp.release.value = params['sc-comp-release'] / 1000; }
    if (params['sc-comp-makeup'] !== undefined) { makeup.gain.value = 10 ** (params['sc-comp-makeup'] / 20); }
}

// ── Limiter ──────────────────────────────────────────────────────────────

export function createLimiter(ctx: BaseAudioContext): OfflineDeviceNode {
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

export function applyLimiterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const compL = dn.nodes[0] as DynamicsCompressorNode;
    const ceilingL = dn.nodes[1] as GainNode;
    if (params['lim-threshold'] !== undefined) { compL.threshold.value = params['lim-threshold']; }
    if (params['lim-release'] !== undefined) { compL.release.value = params['lim-release'] / 1000; }
    if (params['lim-ceiling'] !== undefined) { ceilingL.gain.value = 10 ** (params['lim-ceiling'] / 20); }
}
