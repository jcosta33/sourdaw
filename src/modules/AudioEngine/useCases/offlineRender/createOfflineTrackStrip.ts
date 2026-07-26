import { clampFaderGain } from '#/utils/audioLevelLaw';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

import { type OfflineTrackStrip } from './types';

type CreateOfflineTrackStripTrackInput = {
    gain: number;
    muted: boolean;
    pan: number;
    devices: Device[];
};

type CreateOfflineTrackStripOptions = {
    /**
     * Stem exports pass false: stems of muted tracks must carry the track's
     * content for "later use in a DAW" (exportStems documents this intent).
     * The mixdown path keeps the default — baking mute into the strip there
     * would leak muted-track audio otherwise (PR #616 review).
     */
    honorMuted?: boolean;
    /**
     * The track's VCA group master, as a plain multiplier (`1` when the track
     * belongs to no group). Live folds this into every fader write — the VCA
     * writer sends `trackGain * groupGain` and the gain-automation branch sends
     * `dbToGain(value) * groupGain` — so a strip seeded from the raw stored
     * gain bounces a VCA-member track at a different level than it plays.
     *
     * The multiply happens *before* the fader clamp, matching live, where the
     * clamp lives inside `TrackNode` and therefore sees the product. Clamping
     * first and multiplying after is a different number whenever the product
     * crosses unity.
     */
    vcaMultiplier?: number;
};

export async function createOfflineTrackStrip(
    offlineCtx: OfflineAudioContext,
    track: CreateOfflineTrackStripTrackInput,
    options: CreateOfflineTrackStripOptions = {}
): Promise<OfflineTrackStrip> {
    const honorMuted = options.honorMuted ?? true;
    const vcaMultiplier = options.vcaMultiplier ?? 1;
    const inputNode = offlineCtx.createGain();
    inputNode.gain.value = 1;

    const preFaderTap = offlineCtx.createGain();
    preFaderTap.gain.value = 1;

    const faderNode = offlineCtx.createGain();
    // FX-7: the live fader clamps to [0, 1] (`TrackNode.setGain`). This path
    // clamped only the floor, so a stored gain above unity — which importers and
    // older projects can carry — rendered louder on export than it ever played
    // back. The two runtimes must apply the same level law.
    //
    // The VCA group master multiplies in first, then the pair is clamped
    // together — the order live composes in.
    faderNode.gain.value = clampFaderGain(track.gain * vcaMultiplier);

    const postFaderGain = offlineCtx.createGain();
    // Mixdown bakes mute into the strip; stem exports opt out so muted
    // tracks still export their content (M-037).
    postFaderGain.gain.value = honorMuted && track.muted ? 0 : 1;

    const panNode = offlineCtx.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, track.pan / 50));

    const outputNode = offlineCtx.createGain();
    outputNode.gain.value = 1;

    const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, inputNode, preFaderTap);

    preFaderTap.connect(faderNode);
    faderNode.connect(postFaderGain);
    postFaderGain.connect(panNode);
    panNode.connect(outputNode);

    return {
        inputNode,
        preFaderTap,
        faderNode,
        postFaderGain,
        panNode,
        outputNode,
        deviceEntries,
    };
}
