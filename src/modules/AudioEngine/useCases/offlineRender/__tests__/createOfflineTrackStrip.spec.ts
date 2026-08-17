import { beforeEach, describe, it, expect, vi } from 'vitest';

import { createOfflineTrackStrip } from '../createOfflineTrackStrip';

const mocks = vi.hoisted(() => ({
    buildDeviceChain: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([])),
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
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.buildDeviceChain.mockResolvedValue([]);
    });

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
                id: 'stem-track',
                name: 'Stem track',
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
            id: 'mixdown-track',
            name: 'Mixdown track',
            gain: 0.8,
            muted: true,
            pan: 0,
            devices: [],
        });

        expect(strip.postFaderGain.gain.value).toBe(0);
    });

    // The chain build names the track in every failure and every degraded-device
    // warning. Both used to be options nobody passed, so every message read
    // `Track "unknown track"` and no degraded device reached the export UI.
    // The name travels on the track it describes, so a caller cannot hand over a
    // track and forget to say which one it is.
    it('names the track and forwards the export warning channel to the chain build', async () => {
        const onWarning = vi.fn();

        await createOfflineTrackStrip(
            makeOfflineCtx(),
            { id: 'lead-vox', name: 'Lead Vox', gain: 0.8, muted: false, pan: 0, devices: [] },
            { onWarning }
        );

        expect(mocks.buildDeviceChain.mock.calls[0]?.[4]).toMatchObject({
            trackName: 'Lead Vox',
            onWarning,
        });
    });

    // A strip the render never schedules contributes silence, so an
    // unrenderable device on it cannot make the file differ from the session.
    it('tells the chain build when the track contributes no audio to the render', async () => {
        await createOfflineTrackStrip(
            makeOfflineCtx(),
            { id: 'muted', name: 'Muted', gain: 0.8, muted: true, pan: 0, devices: [] },
            { contributesAudio: false }
        );

        expect(mocks.buildDeviceChain.mock.calls[0]?.[4]).toMatchObject({ contributesAudio: false });
    });

    it('keeps the strip audible for an unmuted track', async () => {
        const strip = await createOfflineTrackStrip(makeOfflineCtx(), {
            id: 'unmuted-track',
            name: 'Unmuted track',
            gain: 0.8,
            muted: false,
            pan: 0,
            devices: [],
        });

        expect(strip.postFaderGain.gain.value).toBe(1);
        expect(strip.faderNode.gain.value).toBe(0.8);
    });
});
