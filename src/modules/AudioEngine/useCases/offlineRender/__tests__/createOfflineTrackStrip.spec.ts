import { describe, it, expect, vi } from 'vitest';

import { createOfflineTrackStrip } from '../createOfflineTrackStrip';

const mocks = vi.hoisted(() => ({
    buildDeviceChain: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
}));

function makeOfflineCtx(): OfflineAudioContext {
    return {
        createGain: vi.fn(() => ({ gain: { value: -1 }, connect: vi.fn() })),
        createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
    } as unknown as OfflineAudioContext;
}

describe('createOfflineTrackStrip', () => {
    /// Regression (M-037): the post-fader mute gain zeroed the strip for
    /// muted tracks, so stem exports of muted tracks were digital silence —
    /// contradicting the documented intent that stems carry the track's
    /// content for "later use in a DAW". Scoped to the stem path: the
    /// mixdown keeps baking mute in (PR #616 review — an unconditional
    /// unmute leaked muted-track audio into the mixdown).
    it('keeps the stem audible for a muted track on the stem path', async () => {
        const strip = await createOfflineTrackStrip(
            makeOfflineCtx(),
            {
                gain: 0.8,
                muted: true,
                pan: 0,
                devices: [],
            },
            { honorMuted: false }
        );

        expect(strip.postFaderGain.gain.value).toBe(1);
    });

    it('bakes mute into the strip on the mixdown path (default)', async () => {
        const strip = await createOfflineTrackStrip(makeOfflineCtx(), {
            gain: 0.8,
            muted: true,
            pan: 0,
            devices: [],
        });

        expect(strip.postFaderGain.gain.value).toBe(0);
    });

    it('keeps the strip audible for an unmuted track', async () => {
        const strip = await createOfflineTrackStrip(makeOfflineCtx(), {
            gain: 0.8,
            muted: false,
            pan: 0,
            devices: [],
        });

        expect(strip.postFaderGain.gain.value).toBe(1);
        expect(strip.faderNode.gain.value).toBe(0.8);
    });
});
