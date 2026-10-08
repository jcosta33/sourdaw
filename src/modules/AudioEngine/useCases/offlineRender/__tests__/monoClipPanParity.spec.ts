import { describe, expect, it } from 'vitest';

import { createOfflineTrackStrip } from '../createOfflineTrackStrip';
import { scheduleOfflineClipSource } from '../scheduleOfflineClipSource';

import { createNullTestRenderHarness, type HarnessAudioBuffer } from './nullTestRenderHarness';

/**
 * #4686: a mono clip on a centred track rendered 3.01 dB under the native
 * engine on Web Audio. The native engine plays a mono source to both outputs
 * (L = R = s) and then pans with `stereo_pan_gains` in
 * `crates/daw-engine/src/timeline.rs`; Web Audio's `StereoPannerNode` applies
 * its one-channel law to a one-channel input unless the strip up-mixes first.
 *
 * The render is the production offline strip — `createOfflineTrackStrip` fed
 * by `scheduleOfflineClipSource` — on the null-test harness, which models the
 * spec's channel-count rules so a mono source reaches the panner as mono
 * unless the strip says otherwise. The expectations restate the native law in
 * closed form for a dual-mono input.
 */

const SAMPLE_RATE = 48_000;
const CLIP_SECONDS = 1;
const FRAMES = SAMPLE_RATE * CLIP_SECONDS;
const SOURCE_LEVEL = 0.5;
const MEASURED_FRAME = FRAMES / 2;

function constantBuffer(channels: number): HarnessAudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(FRAMES).fill(SOURCE_LEVEL));
    return {
        sampleRate: SAMPLE_RATE,
        length: FRAMES,
        duration: CLIP_SECONDS,
        numberOfChannels: channels,
        getChannelData: (channel: number) => data[channel] ?? data[0]!,
    };
}

/** `stereo_pan_gains` applied to L = R = `level`, with `pan` on the node's −1…+1 scale. */
function nativeLaw(level: number, pan: number): { left: number; right: number } {
    if (pan === 0) {
        return { left: level, right: level };
    }
    if (pan < 0) {
        const angle = (pan + 1) * (Math.PI / 2);
        return { left: level + level * Math.cos(angle), right: level * Math.sin(angle) };
    }
    const angle = pan * (Math.PI / 2);
    return { left: level * Math.cos(angle), right: level + level * Math.sin(angle) };
}

async function renderClipThroughStrip(input: {
    channels: number;
    storedPan: number;
}): Promise<{ left: number; right: number }> {
    const harness = createNullTestRenderHarness();
    const context = new harness.OfflineAudioContext(2, FRAMES, SAMPLE_RATE, { automation: 'scheduled' });
    const strip = await createOfflineTrackStrip(context as unknown as OfflineAudioContext, {
        id: 'mono-clip-track',
        name: 'Mono clip track',
        gain: 1,
        muted: false,
        pan: input.storedPan,
        devices: [],
    });
    strip.outputNode.connect(context.destination as unknown as AudioNode);
    scheduleOfflineClipSource({
        context: context as unknown as BaseAudioContext,
        destinationNode: strip.inputNode,
        buffer: constantBuffer(input.channels) as unknown as AudioBuffer,
        startSec: 0,
        bufferOffsetSec: 0,
        playDuration: CLIP_SECONDS,
        playbackRate: 1,
        clipGainValue: 1,
        envelope: undefined,
        microFadeSeconds: 0,
    });
    const rendered = await context.startRendering();
    return {
        left: rendered.getChannelData(0)[MEASURED_FRAME]!,
        right: rendered.getChannelData(1)[MEASURED_FRAME]!,
    };
}

describe('a mono clip on the Web Audio offline strip pans like the native engine', () => {
    it.each([
        { name: 'centre', storedPan: 0, nodePan: 0 },
        { name: 'half right', storedPan: 25, nodePan: 0.5 },
        { name: 'half left', storedPan: -25, nodePan: -0.5 },
    ])('renders the same level as native at $name', async ({ storedPan, nodePan }) => {
        const rendered = await renderClipThroughStrip({ channels: 1, storedPan });
        const expected = nativeLaw(SOURCE_LEVEL, nodePan);

        expect(rendered.left).toBeCloseTo(expected.left, 6);
        expect(rendered.right).toBeCloseTo(expected.right, 6);
    });

    it('keeps a centred mono clip at unity, not 3.01 dB down', async () => {
        const rendered = await renderClipThroughStrip({ channels: 1, storedPan: 0 });

        expect(rendered.left).toBeCloseTo(SOURCE_LEVEL, 6);
        expect(rendered.right).toBeCloseTo(SOURCE_LEVEL, 6);
    });

    it('leaves a stereo clip on the same law, so stereo material is unaffected', async () => {
        const centre = await renderClipThroughStrip({ channels: 2, storedPan: 0 });
        const panned = await renderClipThroughStrip({ channels: 2, storedPan: 25 });

        expect(centre.left).toBeCloseTo(SOURCE_LEVEL, 6);
        expect(centre.right).toBeCloseTo(SOURCE_LEVEL, 6);
        const expected = nativeLaw(SOURCE_LEVEL, 0.5);
        expect(panned.left).toBeCloseTo(expected.left, 6);
        expect(panned.right).toBeCloseTo(expected.right, 6);
    });
});
