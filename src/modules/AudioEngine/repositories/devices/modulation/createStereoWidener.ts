import { type OfflineDeviceNode } from '../types';

// ── Stereo Widener ───────────────────────────────────────────────────────

export function createStereoWidener(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    // Mid = (L + R) * 0.5
    // Side = (L - R) * 0.5

    const midSum = ctx.createGain();
    midSum.gain.value = 0.5; // (L+R) * 0.5

    const sideSum = ctx.createGain();
    sideSum.gain.value = 0.5; // Will be L - R * 0.5

    const rightInvert = ctx.createGain();
    rightInvert.gain.value = -1; // -R

    const midGain = ctx.createGain();
    midGain.gain.value = 1;

    const sideGain = ctx.createGain();
    sideGain.gain.value = 1;

    const monoBassFilter = ctx.createBiquadFilter();
    monoBassFilter.type = 'highpass'; // Highpass the Side signal to remove bass from stereo field
    monoBassFilter.frequency.value = 200;

    const sideInvert = ctx.createGain();
    sideInvert.gain.value = -1; // -S for Right channel reconstruction

    input.connect(splitter);

    // Create Mid: L + R
    splitter.connect(midSum, 0);
    splitter.connect(midSum, 1);

    // Create Side: L - R
    splitter.connect(sideSum, 0); // L
    splitter.connect(rightInvert, 1); // R
    rightInvert.connect(sideSum); // -R

    // Apply width control
    midSum.connect(midGain);

    // Side goes through highpass to keep bass mono, then to side gain
    sideSum.connect(monoBassFilter);
    monoBassFilter.connect(sideGain);

    // Decode Matrix: L = M + S, R = M - S
    sideGain.connect(sideInvert);

    // Left Out: M + S
    midGain.connect(merger, 0, 0);
    sideGain.connect(merger, 0, 0);

    // Right Out: M - S
    midGain.connect(merger, 0, 1);
    sideInvert.connect(merger, 0, 1);

    merger.connect(output);

    return {
        inputNode: input,
        outputNode: output,
        nodes: [
            input,
            output,
            splitter,
            merger,
            midSum,
            sideSum,
            rightInvert,
            midGain,
            sideGain,
            monoBassFilter,
            sideInvert,
        ],
        namedNodes: {
            input, output, splitter, merger,
            midSum, sideSum, rightInvert,
            midGain, sideGain, monoBassFilter, sideInvert,
        },
    };
}